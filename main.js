const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

// --- IPC ---
// All privileged work (native dialog, filesystem) lives in the main process and
// is reached from the renderer only through the contextBridge preload.

// Open a native folder picker. Resolves to the chosen absolute path, or null if canceled.
ipcMain.handle('dialog:pickFolder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// List the top-level files in a folder (skips subdirectories/symlinks).
// Returns [{ name, path, ext, mtimeMs, size }]. ext/mtimeMs/size are unused in
// Batch 2 but pre-wire Batch 3 (render by ext) and Batch 4 (sort by mtime).
ipcMain.handle('files:list', async (event, folderPath) => {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(folderPath, entry.name);
    try {
      const stats = await fs.stat(fullPath);
      files.push({
        name: entry.name,
        path: fullPath,
        ext: path.extname(entry.name).toLowerCase(),
        mtimeMs: stats.mtimeMs,
        size: stats.size,
      });
    } catch {
      // Skip files we can't stat (permissions, or removed out from under us).
    }
  }
  return files;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    backgroundColor: '#1e1e1e',
    title: 'gallery-gauntlet',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  // macOS: re-create a window when the dock icon is clicked and none are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
