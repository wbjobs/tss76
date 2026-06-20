const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Database = require('./db');
const Aggregator = require('./aggregator');

class TaskDashboardApp {
  constructor() {
    this.mainWindow = null;
    this.db = null;
    this.aggregator = null;
    this.init();
  }

  init() {
    app.whenReady().then(() => {
      this.db = new Database();
      this.db.init();
      this.aggregator = new Aggregator(this.db, this);
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
  }

  broadcast(event, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(event, data);
    }
  }
}

new TaskDashboardApp();
