const { contextBridge, ipcRenderer } = require('electron');

// The single, safe surface the renderer can see. Main-process privileged work
// (native dialog, filesystem) is reached only through these IPC-backed methods.
contextBridge.exposeInMainWorld('galleryGauntlet', {
  // Opens a native folder picker; resolves to the chosen absolute path, or null if canceled.
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  // Lists top-level files in a folder: [{ name, path, ext, mtimeMs, size }].
  listFiles: (folderPath) => ipcRenderer.invoke('files:list', folderPath),
});
