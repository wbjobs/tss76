const { createAdapter } = require('./adapters');

const DEFAULT_POLL_INTERVAL = 30000;
const DEFAULT_SOURCE_TIMEOUT = 15000;

class Aggregator {
  constructor(db, app, alertManager = null) {
    this.db = db;
    this.app = app;
    this.alertManager = alertManager;
    this.sources = [];
    this.adapters = new Map();
    this.tasks = [];
    this.timer = null;
    this.lastRefresh = null;
    this.isRefreshing = false;
    this.sourceStatus = new Map();
    this.pollInterval = DEFAULT_POLL_INTERVAL;
  }

  getSourceTimeout(source) {
    const configured = source.config && source.config.timeout;
    if (typeof configured === 'number' && configured > 0) {
      return configured;
    }
    return DEFAULT_SOURCE_TIMEOUT;
  }

  fetchWithTimeout(adapter, source) {
    const timeout = this.getSourceTimeout(source);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`数据源超时 (${timeout}ms)`));
      }, timeout);
      adapter.fetchTasks().then(
        (result) => { clearTimeout(timer); resolve(result); },
        (err) => { clearTimeout(timer); reject(err); }
      );
    });
  }

  start() {
    this.refreshSources();
    this.forceRefresh();
    this.timer = setInterval(() => this.forceRefresh(), this.pollInterval);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  refreshSources() {
    this.sources = this.db.getDataSources().filter(s => s.enabled);
    this.adapters.clear();
    for (const source of this.sources) {
      try {
        this.adapters.set(source.id, createAdapter(source.type, source.config));
      } catch (e) {
        console.error(`Failed to create adapter for source ${source.name}:`, e.message);
      }
    }
  }

  async testConnection(dataSource) {
    try {
      const adapter = createAdapter(dataSource.type, dataSource.config);
      return await adapter.test();
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  async forceRefresh() {
    if (this.isRefreshing) return;
    this.isRefreshing = true;

    try {
      const fetchPromises = this.sources.map((source) => {
        const adapter = this.adapters.get(source.id);
        if (!adapter) return null;

        const statusEntry = {
          sourceId: source.id,
          sourceName: source.name,
          sourceType: source.type,
          timeout: this.getSourceTimeout(source),
          lastAttempt: new Date().toISOString(),
          success: false,
          error: null,
          taskCount: 0
        };

        return this.fetchWithTimeout(adapter, source)
          .then((tasks) => {
            for (const task of tasks) {
              task.sourceId = source.id;
              task.sourceName = source.name;
            }
            statusEntry.success = true;
            statusEntry.taskCount = tasks.length;
            return { statusEntry, tasks };
          })
          .catch((e) => {
            console.error(`Error fetching from ${source.name}:`, e.message);
            statusEntry.error = e.message;
            return { statusEntry, tasks: [] };
          });
      }).filter(Boolean);

      const results = await Promise.allSettled(fetchPromises);

      const allTasks = [];
      const sourceStatuses = [];

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          const { statusEntry, tasks } = result.value;
          allTasks.push(...tasks);
          sourceStatuses.push(statusEntry);
          this.sourceStatus.set(statusEntry.sourceId, statusEntry);
        }
      }

      this.tasks = allTasks;
      this.lastRefresh = new Date().toISOString();

      const aggregated = this.buildAggregatedData(sourceStatuses);

      try {
        this.db.saveSnapshot(aggregated);
      } catch (e) {
        console.error('Failed to save snapshot:', e.message);
      }

      this.app.broadcast('data-updated', aggregated);

      if (this.alertManager) {
        try {
          this.alertManager.evaluateRules(aggregated);
        } catch (e) {
          console.error('Alert evaluation error:', e.message);
        }
      }
    } finally {
      this.isRefreshing = false;
    }
  }

  buildAggregatedData(sourceStatuses) {
    const total = this.tasks.length;
    const counts = {
      success: 0,
      failed: 0,
      running: 0,
      pending: 0,
      warning: 0,
      unknown: 0
    };

    const bySource = {};

    for (const task of this.tasks) {
      counts[task.state] = (counts[task.state] || 0) + 1;

      if (!bySource[task.sourceId]) {
        bySource[task.sourceId] = {
          sourceId: task.sourceId,
          sourceName: task.sourceName,
          sourceType: task.sourceType,
          tasks: [],
          counts: { success: 0, failed: 0, running: 0, pending: 0, warning: 0, unknown: 0 }
        };
      }
      bySource[task.sourceId].tasks.push(task);
      bySource[task.sourceId].counts[task.state] = (bySource[task.sourceId].counts[task.state] || 0) + 1;
    }

    const sortedTasks = [...this.tasks].sort((a, b) => {
      const order = { running: 0, pending: 1, warning: 2, failed: 3, success: 4, unknown: 5 };
      if (order[a.state] !== order[b.state]) return order[a.state] - order[b.state];
      return (b.startTime || '').localeCompare(a.startTime || '');
    });

    return {
      timestamp: this.lastRefresh,
      total,
      counts,
      sources: sourceStatuses || [],
      bySource: Object.values(bySource),
      tasks: sortedTasks
    };
  }

  getAggregatedData() {
    const sourceStatuses = Array.from(this.sourceStatus.values());
    return this.buildAggregatedData(sourceStatuses);
  }

  getStatus() {
    return {
      isRunning: this.timer !== null,
      isRefreshing: this.isRefreshing,
      lastRefresh: this.lastRefresh,
      pollInterval: this.pollInterval,
      sourceCount: this.sources.length,
      taskCount: this.tasks.length
    };
  }
}

module.exports = Aggregator;
