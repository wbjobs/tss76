const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Database = require('./db');
const Aggregator = require('./aggregator');
const AlertManager = require('./alert-manager');

class TaskDashboardApp {
  constructor() {
    this.mainWindow = null;
    this.db = null;
    this.aggregator = null;
    this.alertManager = null;
    this.init();
  }

  init() {
    app.whenReady().then(() => {
      this.db = new Database();
      this.db.init();
      this.alertManager = new AlertManager(this.db, this);
      this.aggregator = new Aggregator(this.db, this, this.alertManager);
      this.createWindow();
      this.registerIPC();
      this.aggregator.start();
    });

    app.on('window-all-closed', () => {
      this.aggregator.stop();
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createWindow();
      }
    });
  }

  createWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1024,
      minHeight: 700,
      webPreferences: {
        preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      },
      title: '分布式任务进度聚合看板',
      backgroundColor: '#0f172a'
    });

    this.mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  registerIPC() {
    ipcMain.handle('get-data-sources', () => {
      return this.db.getDataSources();
    });

    ipcMain.handle('add-data-source', (event, dataSource) => {
      return this.db.addDataSource(dataSource);
    });

    ipcMain.handle('update-data-source', (event, id, dataSource) => {
      return this.db.updateDataSource(id, dataSource);
    });

    ipcMain.handle('delete-data-source', (event, id) => {
      return this.db.deleteDataSource(id);
      this.aggregator.refreshSources();
    });

    ipcMain.handle('test-connection', async (event, dataSource) => {
      return this.aggregator.testConnection(dataSource);
    });

    ipcMain.handle('get-aggregated-data', () => {
      return this.aggregator.getAggregatedData();
    });

    ipcMain.handle('get-history-snapshots', (event, limit = 50) => {
      return this.db.getHistorySnapshots(limit);
    });

    ipcMain.handle('refresh-now', () => {
      return this.aggregator.forceRefresh();
    });

    ipcMain.handle('get-aggregator-status', () => {
      return this.aggregator.getStatus();
    });

    ipcMain.handle('get-alert-rules', () => {
      return this.db.getAlertRules();
    });

    ipcMain.handle('add-alert-rule', (event, rule) => {
      return this.db.addAlertRule(rule);
    });

    ipcMain.handle('update-alert-rule', (event, id, rule) => {
      return this.db.updateAlertRule(id, rule);
    });

    ipcMain.handle('delete-alert-rule', (event, id) => {
      return this.db.deleteAlertRule(id);
    });

    ipcMain.handle('get-alert-events', (event, limit = 100) => {
      return this.db.getAlertEvents(limit);
    });

    ipcMain.handle('test-alert-notification', (event, ruleData) => {
      return this.alertManager.testNotification(ruleData || { name: '测试告警' });
    });
  }

  broadcast(event, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(event, data);
    }
  }
}

new TaskDashboardApp();
