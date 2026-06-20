const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dashboardAPI', {
  getDataSources: () => ipcRenderer.invoke('get-data-sources'),
  addDataSource: (dataSource) => ipcRenderer.invoke('add-data-source', dataSource),
  updateDataSource: (id, dataSource) => ipcRenderer.invoke('update-data-source', id, dataSource),
  deleteDataSource: (id) => ipcRenderer.invoke('delete-data-source', id),
  testConnection: (dataSource) => ipcRenderer.invoke('test-connection', dataSource),

  getAggregatedData: () => ipcRenderer.invoke('get-aggregated-data'),
  getHistorySnapshots: (limit) => ipcRenderer.invoke('get-history-snapshots', limit),
  refreshNow: () => ipcRenderer.invoke('refresh-now'),
  getAggregatorStatus: () => ipcRenderer.invoke('get-aggregator-status'),

  onDataUpdated: (callback) => {
    ipcRenderer.on('data-updated', (event, data) => callback(data));
  },

  removeDataUpdatedListener: () => {
    ipcRenderer.removeAllListeners('data-updated');
  }
});
