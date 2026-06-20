const path = require('path');
const fs = require('fs');

class Database {
  constructor() {
    this.db = null;
    this.dataPath = this.getDataPath();
  }

  getDataPath() {
    const appDataPath = process.env.APPDATA || path.join(process.env.HOME || process.env.USERPROFILE, 'AppData', 'Roaming');
    const dir = path.join(appDataPath, 'TaskDashboard');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  init() {
    try {
      const Database = require('better-sqlite3');
      const dbPath = path.join(this.dataPath, 'task-dashboard.db');
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.createTables();
    } catch (err) {
      console.error('Failed to initialize database:', err);
      this.initFallback();
    }
  }

  initFallback() {
    this.fallbackStorage = {
      dataSources: [],
      snapshots: [],
      alertRules: [],
      alertEvents: []
    };
    const storagePath = path.join(this.dataPath, 'fallback-storage.json');
    this.storagePath = storagePath;
    if (fs.existsSync(storagePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
        this.fallbackStorage = data;
      } catch (e) {}
    }
    this.useFallback = true;
  }

  saveFallback() {
    if (this.storagePath && this.fallbackStorage) {
      fs.writeFileSync(this.storagePath, JSON.stringify(this.fallbackStorage, null, 2));
    }
  }

  createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS data_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        config TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS history_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_data TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_created ON history_snapshots(created_at DESC);

      CREATE TABLE IF NOT EXISTS alert_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        condition_json TEXT NOT NULL,
        action_json TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        cooldown_seconds INTEGER DEFAULT 300,
        last_triggered_at DATETIME,
        trigger_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS alert_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_id INTEGER NOT NULL,
        rule_name TEXT NOT NULL,
        event_type TEXT NOT NULL,
        task_id TEXT,
        task_name TEXT,
        source_name TEXT,
        message TEXT NOT NULL,
        payload_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_events_created ON alert_events(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_events_rule ON alert_events(rule_id);
    `);
  }

  getDataSources() {
    if (this.useFallback) {
      return this.fallbackStorage.dataSources.map(ds => ({
        ...ds,
        config: typeof ds.config === 'string' ? JSON.parse(ds.config) : ds.config
      }));
    }
    const rows = this.db.prepare('SELECT * FROM data_sources ORDER BY created_at DESC').all();
    return rows.map(row => ({
      ...row,
      config: JSON.parse(row.config),
      enabled: row.enabled === 1
    }));
  }

  getDataSource(id) {
    if (this.useFallback) {
      const ds = this.fallbackStorage.dataSources.find(d => d.id === id);
      return ds ? { ...ds, config: typeof ds.config === 'string' ? JSON.parse(ds.config) : ds.config } : null;
    }
    const row = this.db.prepare('SELECT * FROM data_sources WHERE id = ?').get(id);
    if (!row) return null;
    return {
      ...row,
      config: JSON.parse(row.config),
      enabled: row.enabled === 1
    };
  }

  addDataSource(dataSource) {
    const configStr = JSON.stringify(dataSource.config || {});
    if (this.useFallback) {
      const newDs = {
        id: Date.now(),
        name: dataSource.name,
        type: dataSource.type,
        config: dataSource.config || {},
        enabled: dataSource.enabled !== false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      this.fallbackStorage.dataSources.unshift(newDs);
      this.saveFallback();
      return newDs.id;
    }
    const stmt = this.db.prepare(`
      INSERT INTO data_sources (name, type, config, enabled)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(
      dataSource.name,
      dataSource.type,
      configStr,
      dataSource.enabled !== false ? 1 : 0
    );
    return result.lastInsertRowid;
  }

  updateDataSource(id, dataSource) {
    const configStr = JSON.stringify(dataSource.config || {});
    if (this.useFallback) {
      const idx = this.fallbackStorage.dataSources.findIndex(d => d.id === id);
      if (idx >= 0) {
        this.fallbackStorage.dataSources[idx] = {
          ...this.fallbackStorage.dataSources[idx],
          name: dataSource.name,
          type: dataSource.type,
          config: dataSource.config || {},
          enabled: dataSource.enabled !== false,
          updated_at: new Date().toISOString()
        };
        this.saveFallback();
        return true;
      }
      return false;
    }
    const stmt = this.db.prepare(`
      UPDATE data_sources SET name = ?, type = ?, config = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    const result = stmt.run(
      dataSource.name,
      dataSource.type,
      configStr,
      dataSource.enabled !== false ? 1 : 0,
      id
    );
    return result.changes > 0;
  }

  deleteDataSource(id) {
    if (this.useFallback) {
      const idx = this.fallbackStorage.dataSources.findIndex(d => d.id === id);
      if (idx >= 0) {
        this.fallbackStorage.dataSources.splice(idx, 1);
        this.saveFallback();
        return true;
      }
      return false;
    }
    const stmt = this.db.prepare('DELETE FROM data_sources WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  saveSnapshot(snapshotData) {
    const dataStr = JSON.stringify(snapshotData);
    if (this.useFallback) {
      this.fallbackStorage.snapshots.unshift({
        id: Date.now(),
        snapshot_data: snapshotData,
        created_at: new Date().toISOString()
      });
      if (this.fallbackStorage.snapshots.length > 500) {
        this.fallbackStorage.snapshots = this.fallbackStorage.snapshots.slice(0, 500);
      }
      this.saveFallback();
      return;
    }
    this.db.prepare('INSERT INTO history_snapshots (snapshot_data) VALUES (?)').run(dataStr);
    this.db.prepare('DELETE FROM history_snapshots WHERE id IN (SELECT id FROM history_snapshots ORDER BY created_at DESC LIMIT -1 OFFSET 500)').run();
  }

  getHistorySnapshots(limit = 50) {
    if (this.useFallback) {
      return this.fallbackStorage.snapshots.slice(0, limit).map(s => ({
        ...s,
        snapshot_data: typeof s.snapshot_data === 'string' ? JSON.parse(s.snapshot_data) : s.snapshot_data
      }));
    }
    const rows = this.db.prepare('SELECT * FROM history_snapshots ORDER BY created_at DESC LIMIT ?').get(limit);
    return rows.map(row => ({
      ...row,
      snapshot_data: JSON.parse(row.snapshot_data)
    }));
  }

  getAlertRules() {
    if (this.useFallback) {
      return (this.fallbackStorage.alertRules || []).map(r => this._parseRule(r));
    }
    const rows = this.db.prepare('SELECT * FROM alert_rules ORDER BY created_at DESC').all();
    return rows.map(row => this._parseRule(row));
  }

  getAlertRule(id) {
    if (this.useFallback) {
      const r = (this.fallbackStorage.alertRules || []).find(x => x.id === id);
      return r ? this._parseRule(r) : null;
    }
    const row = this.db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(id);
    return row ? this._parseRule(row) : null;
  }

  _parseRule(row) {
    return {
      ...row,
      enabled: row.enabled === 1 || row.enabled === true,
      condition: typeof row.condition_json === 'string' ? JSON.parse(row.condition_json) : (row.condition_json || row.condition || {}),
      action: typeof row.action_json === 'string' ? JSON.parse(row.action_json) : (row.action_json || row.action || {}),
      cooldownSeconds: row.cooldown_seconds !== undefined ? row.cooldown_seconds : (row.cooldownSeconds || 300),
      lastTriggeredAt: row.last_triggered_at || row.lastTriggeredAt || null,
      triggerCount: row.trigger_count !== undefined ? row.trigger_count : (row.triggerCount || 0)
    };
  }

  addAlertRule(rule) {
    const conditionJson = JSON.stringify(rule.condition || {});
    const actionJson = JSON.stringify(rule.action || {});
    const cooldown = typeof rule.cooldownSeconds === 'number' ? rule.cooldownSeconds : 300;

    if (this.useFallback) {
      if (!this.fallbackStorage.alertRules) this.fallbackStorage.alertRules = [];
      const newRule = {
        id: Date.now(),
        name: rule.name,
        condition: rule.condition || {},
        action: rule.action || {},
        enabled: rule.enabled !== false,
        cooldownSeconds: cooldown,
        lastTriggeredAt: null,
        triggerCount: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      this.fallbackStorage.alertRules.unshift(newRule);
      this.saveFallback();
      return newRule.id;
    }
    const stmt = this.db.prepare(`
      INSERT INTO alert_rules (name, condition_json, action_json, enabled, cooldown_seconds)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      rule.name,
      conditionJson,
      actionJson,
      rule.enabled !== false ? 1 : 0,
      cooldown
    );
    return result.lastInsertRowid;
  }

  updateAlertRule(id, rule) {
    const conditionJson = JSON.stringify(rule.condition || {});
    const actionJson = JSON.stringify(rule.action || {});
    const cooldown = typeof rule.cooldownSeconds === 'number' ? rule.cooldownSeconds : 300;

    if (this.useFallback) {
      if (!this.fallbackStorage.alertRules) this.fallbackStorage.alertRules = [];
      const idx = this.fallbackStorage.alertRules.findIndex(r => r.id === id);
      if (idx >= 0) {
        this.fallbackStorage.alertRules[idx] = {
          ...this.fallbackStorage.alertRules[idx],
          name: rule.name,
          condition: rule.condition || {},
          action: rule.action || {},
          enabled: rule.enabled !== false,
          cooldownSeconds: cooldown,
          updated_at: new Date().toISOString()
        };
        this.saveFallback();
        return true;
      }
      return false;
    }
    const stmt = this.db.prepare(`
      UPDATE alert_rules SET name = ?, condition_json = ?, action_json = ?, enabled = ?,
        cooldown_seconds = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    const result = stmt.run(
      rule.name,
      conditionJson,
      actionJson,
      rule.enabled !== false ? 1 : 0,
      cooldown,
      id
    );
    return result.changes > 0;
  }

  deleteAlertRule(id) {
    if (this.useFallback) {
      if (!this.fallbackStorage.alertRules) this.fallbackStorage.alertRules = [];
      const idx = this.fallbackStorage.alertRules.findIndex(r => r.id === id);
      if (idx >= 0) {
        this.fallbackStorage.alertRules.splice(idx, 1);
        this.saveFallback();
        return true;
      }
      return false;
    }
    this.db.prepare('DELETE FROM alert_events WHERE rule_id = ?').run(id);
    const stmt = this.db.prepare('DELETE FROM alert_rules WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  markRuleTriggered(id) {
    const now = new Date().toISOString();
    if (this.useFallback) {
      const rule = (this.fallbackStorage.alertRules || []).find(r => r.id === id);
      if (rule) {
        rule.lastTriggeredAt = now;
        rule.triggerCount = (rule.triggerCount || 0) + 1;
        this.saveFallback();
      }
      return;
    }
    this.db.prepare(`
      UPDATE alert_rules SET last_triggered_at = ?, trigger_count = trigger_count + 1
      WHERE id = ?
    `).run(now, id);
  }

  addAlertEvent(event) {
    const payloadJson = event.payload ? JSON.stringify(event.payload) : null;

    if (this.useFallback) {
      if (!this.fallbackStorage.alertEvents) this.fallbackStorage.alertEvents = [];
      const newEvent = {
        id: Date.now() + Math.random(),
        rule_id: event.ruleId,
        rule_name: event.ruleName,
        event_type: event.eventType,
        task_id: event.taskId || null,
        task_name: event.taskName || null,
        source_name: event.sourceName || null,
        message: event.message,
        payload_json: event.payload || null,
        created_at: new Date().toISOString()
      };
      this.fallbackStorage.alertEvents.unshift(newEvent);
      if (this.fallbackStorage.alertEvents.length > 500) {
        this.fallbackStorage.alertEvents = this.fallbackStorage.alertEvents.slice(0, 500);
      }
      this.saveFallback();
      return;
    }
    this.db.prepare(`
      INSERT INTO alert_events (rule_id, rule_name, event_type, task_id, task_name, source_name, message, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.ruleId,
      event.ruleName,
      event.eventType,
      event.taskId || null,
      event.taskName || null,
      event.sourceName || null,
      event.message,
      payloadJson
    );
    this.db.prepare('DELETE FROM alert_events WHERE id IN (SELECT id FROM alert_events ORDER BY created_at DESC LIMIT -1 OFFSET 500)').run();
  }

  getAlertEvents(limit = 100) {
    if (this.useFallback) {
      const events = (this.fallbackStorage.alertEvents || []).slice(0, limit);
      return events.map(e => ({
        ...e,
        ruleId: e.rule_id || e.ruleId,
        ruleName: e.rule_name || e.ruleName,
        eventType: e.event_type || e.eventType,
        taskId: e.task_id || e.taskId,
        taskName: e.task_name || e.taskName,
        sourceName: e.source_name || e.sourceName,
        payload: typeof e.payload_json === 'string' ? JSON.parse(e.payload_json) : (e.payload_json || e.payload || null)
      }));
    }
    const rows = this.db.prepare('SELECT * FROM alert_events ORDER BY created_at DESC LIMIT ?').all(limit);
    return rows.map(row => ({
      ...row,
      ruleId: row.rule_id,
      ruleName: row.rule_name,
      eventType: row.event_type,
      taskId: row.task_id,
      taskName: row.task_name,
      sourceName: row.source_name,
      payload: row.payload_json ? JSON.parse(row.payload_json) : null
    }));
  }
}

module.exports = Database;
