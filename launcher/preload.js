'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('syncr', {
  close:     () => ipcRenderer.invoke('window:close'),
  minimize:  () => ipcRenderer.invoke('window:minimize'),
  autoSetup: () => ipcRenderer.invoke('syncr:autoSetup'),

  getAutostart: ()   => ipcRenderer.invoke('syncr:getAutostart'),
  setAutostart: (on) => ipcRenderer.invoke('syncr:setAutostart', on),
  startTray:    ()   => ipcRenderer.invoke('syncr:startTray'),

  onLog:      (fn) => ipcRenderer.on('log',      (_e, msg) => fn(msg)),
  onProgress: (fn) => ipcRenderer.on('progress', (_e, pct) => fn(pct)),
  onStep:     (fn) => ipcRenderer.on('step',     (_e, msg) => fn(msg)),
  onPhase:    (fn) => ipcRenderer.on('phase',    (_e, p)   => fn(p)),
});
