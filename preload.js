const { contextBridge, ipcRenderer } = require('electron');

// The single, safe surface the renderer can see. Main-process privileged work
// (native dialog, filesystem, config) is reached only through these IPC-backed methods.
contextBridge.exposeInMainWorld('galleryGauntlet', {
  // Opens a native folder picker; resolves to the chosen absolute path, or null if canceled.
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  // Lists top-level files in a folder: [{ name, path, ext, mtimeMs, size }].
  listFiles: (folderPath) => ipcRenderer.invoke('files:list', folderPath),
  // Moves a file into destDir (collision-safe); resolves to the final destination path.
  moveFile: (src, destDir) => ipcRenderer.invoke('files:move', src, destDir),
  // Opens a folder in the OS file manager; resolves to '' on success or an error string.
  openPath: (dirPath) => ipcRenderer.invoke('shell:openPath', dirPath),
  // Persisted config (key bindings, settings).
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config) => ipcRenderer.invoke('config:set', config),
});
