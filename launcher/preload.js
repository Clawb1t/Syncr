'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('syncr', {
  close:    ()         => ipcRenderer.invoke('window:close'),
  minimize: ()         => ipcRenderer.invoke('window:minimize'),
  check:    ()         => ipcRenderer.invoke('syncr:check'),
  install:  (payload)  => ipcRenderer.invoke('syncr:install', payload),
  update:   (payload)  => ipcRenderer.invoke('syncr:update',  payload),

  onLog:      (fn) => ipcRenderer.on('log',      (_e, msg)  => fn(msg)),
  onProgress: (fn) => ipcRenderer.on('progress', (_e, pct)  => fn(pct)),
});
