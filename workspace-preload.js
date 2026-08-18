'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('saoirseWorkspace', {
  bootstrap: () => ipcRenderer.invoke('workspace:bootstrap'),
  chooseProject: () => ipcRenderer.invoke('workspace:choose'),
  activateProject: (id) => ipcRenderer.invoke('workspace:activate', id),
  removeProject: (id) => ipcRenderer.invoke('workspace:remove', id),
  listDirectory: (relativePath) => ipcRenderer.invoke('workspace:list-directory', relativePath),
  openPath: (relativePath) => ipcRenderer.invoke('workspace:open-path', relativePath),
  revealPath: (relativePath) => ipcRenderer.invoke('workspace:reveal-path', relativePath),
  gitStatus: () => ipcRenderer.invoke('git:status'),
  gitDiff: (relativePath, staged) => ipcRenderer.invoke('git:diff', relativePath, staged),
  gitHistory: () => ipcRenderer.invoke('git:history'),
  gitStage: (paths) => ipcRenderer.invoke('git:stage', paths),
  gitUnstage: (paths) => ipcRenderer.invoke('git:unstage', paths),
  gitCommit: (message) => ipcRenderer.invoke('git:commit', message),
  gitUndoFile: (relativePath) => ipcRenderer.invoke('git:undo-file', relativePath),
  createCheckpoint: (label) => ipcRenderer.invoke('checkpoint:create', label),
  listCheckpoints: () => ipcRenderer.invoke('checkpoint:list'),
  restoreCheckpoint: (id) => ipcRenderer.invoke('checkpoint:restore', id),
  validationSuggestions: () => ipcRenderer.invoke('validation:suggest'),
  listSkills: () => ipcRenderer.invoke('skills:list'),
  readSkill: (id) => ipcRenderer.invoke('skills:read', id),
  saveSkill: (payload) => ipcRenderer.invoke('skills:save', payload),
  toggleSkill: (id, enabled) => ipcRenderer.invoke('skills:toggle', id, enabled),
  deleteSkill: (id) => ipcRenderer.invoke('skills:delete', id),
  importSkill: () => ipcRenderer.invoke('skills:import'),
  setPermission: (mode) => ipcRenderer.invoke('settings:set-permission', mode),
  getAppearance: () => ipcRenderer.invoke('appearance:get'),
  chooseBackground: () => ipcRenderer.invoke('appearance:choose'),
  updateAppearance: (patch) => ipcRenderer.invoke('appearance:update', patch),
  resetAppearance: () => ipcRenderer.invoke('appearance:reset'),
  saveMcp: (payload) => ipcRenderer.invoke('mcp:save', payload),
  toggleMcp: (id, enabled) => ipcRenderer.invoke('mcp:toggle', id, enabled),
  deleteMcp: (id) => ipcRenderer.invoke('mcp:delete', id),
  runCommand: (command) => ipcRenderer.invoke('terminal:run', command),
  stopCommand: () => ipcRenderer.invoke('terminal:stop'),
  resetTerminalCwd: () => ipcRenderer.invoke('terminal:reset-cwd'),
  onWorkspaceChanged: (callback) => subscribe('workspace:changed', callback),
  onBackendState: (callback) => subscribe('workspace:backend-state', callback),
  onTerminalData: (callback) => subscribe('terminal:data', callback),
  onTerminalState: (callback) => subscribe('terminal:state', callback),
  onTerminalCwd: (callback) => subscribe('terminal:cwd', callback),
  onAppearanceChanged: (callback) => subscribe('appearance:changed', callback),
});
