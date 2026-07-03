const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { Readable } = require('node:stream');

// Enable platform HEVC/H.265 decoding where the OS provides it (phone videos are
// frequently HEVC). Harmless if unavailable. Must be set before app is ready.
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');

// Register the custom scheme used to serve local media files to the sandboxed
// renderer (Chromium blocks file:// from the app origin). Must run before app ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'gg', privileges: { standard: true, secure: true, stream: true } },
]);

// Ext -> MIME for the files we serve over gg:// (images + video). Video needs a
// correct type to play; SVG needs image/svg+xml to render in <img>.
const MIME_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg',
  '.png': 'image/png', '.apng': 'image/apng', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
  '.ogv': 'video/ogg', '.mov': 'video/quicktime',
};

function mimeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// Serve a local file to the renderer with HTTP Range support so <video> can seek.
// Images return the whole file (200); ranged requests return 206 partial content.
async function serveLocalFile(request) {
  const target = new URL(request.url).searchParams.get('path');
  if (!target) return new Response('missing path', { status: 400 });

  let size;
  try {
    const stats = await fs.stat(target);
    if (!stats.isFile()) return new Response('not a file', { status: 404 });
    size = stats.size;
  } catch {
    return new Response('not found', { status: 404 });
  }

  const type = mimeFor(target);
  const range = request.headers.get('range');
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());

  if (match) {
    let start;
    let end;
    if (match[1] === '' && match[2] !== '') {
      start = Math.max(0, size - parseInt(match[2], 10)); // suffix: last N bytes
      end = size - 1;
    } else {
      start = match[1] === '' ? 0 : parseInt(match[1], 10);
      end = match[2] === '' ? size - 1 : parseInt(match[2], 10);
    }
    if (start > end || start >= size) {
      return new Response('range not satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      });
    }
    end = Math.min(end, size - 1);
    return new Response(Readable.toWeb(createReadStream(target, { start, end })), {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
      },
    });
  }

  return new Response(Readable.toWeb(createReadStream(target)), {
    status: 200,
    headers: {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(size),
    },
  });
}

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

// Pick a destination path that doesn't overwrite: on a name clash, append " (n)".
async function uniqueDest(destDir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = path.join(destDir, name);
  let n = 1;
  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(destDir, `${base} (${n})${ext}`);
      n++;
    } catch {
      return candidate; // doesn't exist → free to use
    }
  }
}

// Move a file into destDir (collision-safe). Returns the final destination path.
ipcMain.handle('files:move', async (event, srcPath, destDir) => {
  const dest = await uniqueDest(destDir, path.basename(srcPath));
  try {
    await fs.rename(srcPath, dest);
  } catch (err) {
    if (err.code === 'EXDEV') {
      // Cross-device move (e.g. D: -> C:): copy then delete the original.
      await fs.copyFile(srcPath, dest);
      await fs.unlink(srcPath);
    } else {
      throw err;
    }
  }
  return dest;
});

// Persisted app config (bindings, settings, per-folder sorted state) as JSON in userData.
const CONFIG_DEFAULTS = {
  keepKey: 'k', bindings: [], includeSorted: false, sorted: {},
  sortMode: 'date-desc', lastFolder: null, theme: 'system',
};

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

ipcMain.handle('config:get', async () => {
  try {
    const raw = await fs.readFile(configPath(), 'utf8');
    return { ...CONFIG_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...CONFIG_DEFAULTS };
  }
});

// Serialize writes so rapid decisions can't interleave and corrupt config.json.
let configWrite = Promise.resolve();
ipcMain.handle('config:set', (event, config) => {
  const result = configWrite.then(() =>
    fs.writeFile(configPath(), JSON.stringify(config, null, 2), 'utf8'),
  );
  configWrite = result.catch(() => {}); // keep the chain alive if one write fails
  return result;
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
      // Let videos autoplay with sound without a user gesture (desktop app).
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  // Serve local files (images + video, with Range support) via gg://<host>/?path=…
  protocol.handle('gg', serveLocalFile);

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
