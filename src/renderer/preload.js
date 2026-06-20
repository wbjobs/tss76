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
  },

  getAlertRules: () => ipcRenderer.invoke('get-alert-rules'),
  addAlertRule: (rule) => ipcRenderer.invoke('add-alert-rule', rule),
  updateAlertRule: (id, rule) => ipcRenderer.invoke('update-alert-rule', id, rule),
  deleteAlertRule: (id) => ipcRenderer.invoke('delete-alert-rule', id),
  getAlertEvents: (limit) => ipcRenderer.invoke('get-alert-events', limit),
  testAlertNotification: (ruleData) => ipcRenderer.invoke('test-alert-notification', ruleData),

  onAlertsTriggered: (callback) => {
    ipcRenderer.on('alerts-triggered', (event, data) => callback(data));
  }
});
