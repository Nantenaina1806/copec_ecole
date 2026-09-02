'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('copec', {
  testConnection: (databaseUrl) => ipcRenderer.invoke('copec:test-connection', { databaseUrl }),
  saveConfig: (payload) => ipcRenderer.invoke('copec:save-config', payload),
  openPublicUrl: (url) => ipcRenderer.invoke('copec:open-public-url', url),
  onSetupError: (callback) => ipcRenderer.on('setup:error', (_event, message) => callback(message)),
});
