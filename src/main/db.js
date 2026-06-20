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
      snapshots: []
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
}

module.exports = Database;
