const { contextBridge } = require('electron');

// The single, safe surface the renderer can see. Later milestones extend this
// object with IPC-backed methods (folder picker, file listing, move, etc.).
contextBridge.exposeInMainWorld('galleryGauntlet', {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
});
