const BaseAdapter = require('./BaseAdapter');

class RpcAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.listPath = config.listPath || '/tasks';
    this.detailPath = config.detailPath || '/tasks/:id';
  }

  async test() {
    try {
      await this.fetch(`${this.baseUrl}${this.listPath}`);
      return { success: true, message: '连接成功' };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  async fetchTasks() {
    const tasks = [];
    try {
      const data = await this.fetch(`${this.baseUrl}${this.listPath}`);
      const taskList = this.extractTaskList(data);

      for (const rawTask of taskList) {
        tasks.push(this.normalizeTask(rawTask));
      }
    } catch (e) {
      console.error('RPC fetch error:', e.message);
    }
    return tasks;
  }

  extractTaskList(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.tasks)) return data.tasks;
    if (Array.isArray(data.data)) return data.data;
    if (data.result && Array.isArray(data.result)) return data.result;
    return [];
  }

  normalizeTask(raw) {
    const id = raw.id || raw.taskId || raw.task_id || raw.uuid || String(Date.now() + Math.random());
    const name = raw.name || raw.taskName || raw.task_name || raw.title || id;

    const state = this.normalizeState(raw.status || raw.state || 'unknown');
    const progress = typeof raw.progress === 'number'
      ? raw.progress
      : (state === 'success' || state === 'failed' ? 100 : (state === 'running' ? 50 : 0));

    return {
      id: `rpc-${id}`,
      sourceType: 'rpc',
      name,
      taskId: id,
      state,
      progress: Math.min(100, Math.max(0, progress)),
      startTime: raw.startTime || raw.start_time || raw.createdAt || null,
      endTime: raw.endTime || raw.end_time || raw.finishedAt || null,
      externalUrl: raw.url || raw.detailUrl || null,
      worker: raw.worker || raw.node || null,
      retries: raw.retries || 0,
      raw
    };
  }

  normalizeState(rawState) {
    const s = String(rawState).toLowerCase();
    if (['success', 'succeeded', 'completed', 'done', 'finished', 'ok'].includes(s)) return 'success';
    if (['failed', 'failure', 'error', 'crashed', 'aborted'].includes(s)) return 'failed';
    if (['running', 'executing', 'active', 'in_progress', 'processing'].includes(s)) return 'running';
    if (['pending', 'queued', 'waiting', 'scheduled', 'created'].includes(s)) return 'pending';
    if (['warning', 'unstable', 'partial'].includes(s)) return 'warning';
    return 'unknown';
  }
}

module.exports = RpcAdapter;
