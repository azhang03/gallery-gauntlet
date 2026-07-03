// Batch 6: open/sort/render files, configure bindings, and act on them (move/keep)
// with per-folder "Sorted" tracking and an "Include sorted" filter.
const api = window.galleryGauntlet;

const openBtn = document.getElementById('open-btn');
const sortSelect = document.getElementById('sort-select');
const includeSortedEl = document.getElementById('include-sorted');
const muteBtn = document.getElementById('mute-btn');
const folderPathEl = document.getElementById('folder-path');
const positionEl = document.getElementById('position');
const emptyEl = document.getElementById('empty');
const fileViewEl = document.getElementById('file-view');
const fileDisplayEl = document.getElementById('file-display');
const fileNameEl = document.getElementById('file-name');
const bindingsEl = document.getElementById('bindings');
const addBindingBtn = document.getElementById('add-binding');
const captureHintEl = document.getElementById('capture-hint');
const toastEl = document.getElementById('toast');
const themeToggle = document.getElementById('theme-toggle');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

// Extensions Chromium can render inline as images.
const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.jfif', '.png', '.apng', '.gif',
  '.webp', '.bmp', '.svg', '.avif', '.ico',
]);
// Video formats Electron/Chromium can decode. Others fall back to the file icon.
const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.mov']);
// Keys the app owns, so they can't be bound to a directory.
const RESERVED_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Tab', 'Enter', 'Escape']);

let allFiles = [];      // sorted, still-present files in the current folder
let files = [];         // visible list (allFiles minus sorted, unless includeSorted)
let index = 0;
let folder = null;
let isMuted = false;    // persists across videos for the session
let sortMode = 'date-desc'; // 'date-desc' | 'date-asc' | 'random'
let acting = false;     // guards against overlapping async move actions

// Persisted config.
let keepKey = 'k';
let bindings = [];      // [{ key, dir }]
let capture = null;     // pending key capture: { type, dir?, binding? }
let includeSorted = false;
let sortedState = {};   // { [folderPath]: { [filePath]: true } }
let sortedSet = new Set(); // sorted paths in the CURRENT folder
let undoStack = [];     // in-memory undo entries for the CURRENT folder only
let lastFolder = null;  // remembered across launches (resume on startup)
let theme = 'system';   // 'system' | 'light' | 'dark'

openBtn.addEventListener('click', openFolder);
muteBtn.addEventListener('click', toggleMute);
addBindingBtn.addEventListener('click', startAddBinding);
sortSelect.addEventListener('change', () => {
  sortMode = sortSelect.value;
  saveConfig();
  sortFiles();
  refreshVisible();
  index = 0;
  render();
});
includeSortedEl.addEventListener('change', () => {
  includeSorted = includeSortedEl.checked;
  saveConfig();
  refreshVisible();
  index = 0;
  render();
});
themeToggle.addEventListener('click', () => {
  theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
  applyTheme();
  saveConfig();
});
// Keep the toggle icon correct if the OS theme changes while we're on "system".
prefersDark.addEventListener('change', () => { if (theme === 'system') applyTheme(); });

function effectiveTheme() {
  if (theme === 'light' || theme === 'dark') return theme;
  return prefersDark.matches ? 'dark' : 'light';
}

function applyTheme() {
  document.documentElement.dataset.theme = theme;
  const eff = effectiveTheme();
  themeToggle.textContent = eff === 'dark' ? '☀️' : '🌙'; // icon of the mode you'd switch TO
  themeToggle.title = eff === 'dark' ? 'Switch to light' : 'Switch to dark';
}

// Load persisted config on startup.
initConfig();
async function initConfig() {
  const cfg = await api.getConfig();
  theme = cfg.theme || 'system';
  applyTheme();
  keepKey = cfg.keepKey || 'k';
  bindings = Array.isArray(cfg.bindings) ? cfg.bindings : [];
  includeSorted = !!cfg.includeSorted;
  sortedState = cfg.sorted && typeof cfg.sorted === 'object' ? cfg.sorted : {};
  sortMode = cfg.sortMode || 'date-desc';
  lastFolder = cfg.lastFolder || null;
  includeSortedEl.checked = includeSorted;
  sortSelect.value = sortMode;
  renderBindings();
  // Resume the last folder on launch.
  if (lastFolder) loadFolder(lastFolder);
}

// --- files: load / sort / filter / navigate / render ---

async function openFolder() {
  const picked = await api.pickFolder();
  if (!picked) return; // canceled — leave current state untouched
  await loadFolder(picked);
}

async function loadFolder(folderPath) {
  let listed;
  try {
    listed = await api.listFiles(folderPath);
  } catch (err) {
    // Folder unreadable/gone — don't wedge; forget it if it was the remembered one.
    if (lastFolder === folderPath) { lastFolder = null; saveConfig(); }
    folder = null;
    allFiles = [];
    files = [];
    index = 0;
    folderPathEl.textContent = 'No folder selected';
    showEmpty('Open a folder to start sorting.');
    toast('Could not open that folder');
    return;
  }
  folder = folderPath;
  lastFolder = folderPath;
  folderPathEl.textContent = folderPath;
  allFiles = listed;
  sortedSet = new Set(Object.keys(sortedState[folder] || {}));
  undoStack = []; // undo never crosses folders
  sortFiles();
  refreshVisible();
  index = 0;
  render();
  saveConfig(); // remember this folder for next launch
}

// Reorder `allFiles` in place per the current sort mode.
function sortFiles() {
  if (sortMode === 'date-asc') {
    allFiles.sort((a, b) => a.mtimeMs - b.mtimeMs);
  } else if (sortMode === 'date-desc') {
    allFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
  } else if (sortMode === 'random') {
    for (let i = allFiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allFiles[i], allFiles[j]] = [allFiles[j], allFiles[i]];
    }
  }
}

// Derive the visible list from allFiles + the sorted filter.
function refreshVisible() {
  files = includeSorted ? allFiles.slice() : allFiles.filter((f) => !sortedSet.has(f.path));
}

function showEmpty(message) {
  clearDisplay();
  fileViewEl.hidden = true;
  emptyEl.hidden = false;
  emptyEl.textContent = message;
  positionEl.textContent = '';
  muteBtn.hidden = true;
}

// Remove current media, pausing any playing <video> so its audio stops immediately.
function clearDisplay() {
  const video = fileDisplayEl.querySelector('video');
  if (video) video.pause();
  fileDisplayEl.replaceChildren();
}

function render() {
  if (files.length === 0) {
    if (!folder) showEmpty('Open a folder to start sorting.');
    else if (allFiles.length === 0) showEmpty('No files in this folder.');
    else showEmpty('Nothing left to sort 🎉  (toggle "Include sorted" to review)');
    return;
  }

  emptyEl.hidden = true;
  fileViewEl.hidden = false;

  const file = files[index];
  clearDisplay();

  const isVideo = VIDEO_EXTS.has(file.ext);
  muteBtn.hidden = !isVideo;

  if (IMAGE_EXTS.has(file.ext)) {
    const img = document.createElement('img');
    img.alt = file.name;
    img.src = mediaUrl(file);
    img.addEventListener('error', () => {
      fileDisplayEl.replaceChildren(makeIcon(file));
    });
    fileDisplayEl.appendChild(img);
  } else if (isVideo) {
    const video = document.createElement('video');
    video.src = mediaUrl(file);
    video.controls = true;
    video.autoplay = true;
    video.muted = isMuted;
    video.addEventListener('error', () => {
      muteBtn.hidden = true;
      showUnplayable(file);
    });
    fileDisplayEl.appendChild(video);
  } else {
    fileDisplayEl.appendChild(makeIcon(file));
  }

  fileNameEl.textContent = file.name;
  positionEl.textContent = `${index + 1} / ${files.length}`;
}

function mediaUrl(file) {
  return `gg://media/?path=${encodeURIComponent(file.path)}`;
}

function toggleMute() {
  isMuted = !isMuted;
  muteBtn.textContent = isMuted ? '🔇' : '🔊';
  muteBtn.setAttribute('aria-label', isMuted ? 'Unmute videos' : 'Mute videos');
  muteBtn.title = isMuted ? 'Unmute videos' : 'Mute videos';
  const video = fileDisplayEl.querySelector('video');
  if (video) video.muted = isMuted;
}

// A generic document icon with the file's extension labeled on it.
function makeIcon(file) {
  const wrap = document.createElement('div');
  wrap.className = 'file-icon';

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'file-icon__glyph');
  const glyph = document.createElementNS(svgNS, 'path');
  glyph.setAttribute('d', 'M6 2h8l4 4v16H6z M14 2v4h4');
  glyph.setAttribute('fill', 'none');
  glyph.setAttribute('stroke', 'currentColor');
  glyph.setAttribute('stroke-width', '1.5');
  glyph.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(glyph);
  wrap.appendChild(svg);

  const label = document.createElement('span');
  label.className = 'file-icon__ext';
  label.textContent = (file.ext || '').replace('.', '').toUpperCase() || 'FILE';
  wrap.appendChild(label);

  return wrap;
}

// Shown when a video file can't be decoded (unsupported codec / no OS decoder).
function showUnplayable(file) {
  const wrap = document.createElement('div');
  wrap.className = 'unplayable';
  wrap.appendChild(makeIcon(file));
  const note = document.createElement('div');
  note.className = 'unplayable-note';
  note.textContent = "Can't play this video — unsupported codec.";
  wrap.appendChild(note);
  fileDisplayEl.replaceChildren(wrap);
}

// --- actions: move / keep ---

function currentFile() {
  return files[index];
}

async function moveCurrent(binding) {
  if (acting) return;
  const file = currentFile();
  if (!file) return;
  acting = true;
  let toPath;
  try {
    toPath = await api.moveFile(file.path, binding.dir);
  } catch (err) {
    if (err.message && err.message.includes('ENOENT')) {
      // Removed externally between listing and now — skip it (not a decision).
      allFiles = allFiles.filter((f) => f !== file);
      toast('File no longer exists — skipped');
      advanceAfterDecision(false);
    } else {
      toast(`Move failed: ${err.message}`);
    }
    acting = false;
    return;
  }
  allFiles = allFiles.filter((f) => f !== file); // it's gone from this folder now
  markSorted(file.path);
  undoStack.push({ type: 'move', file, toPath, dir: folder });
  toast(`→ ${dirLabel(binding.dir)}`);
  advanceAfterDecision(false);
  acting = false;
}

function keepCurrent() {
  const file = currentFile();
  if (!file) return;
  markSorted(file.path);
  undoStack.push({ type: 'keep', file });
  toast('Kept');
  advanceAfterDecision(includeSorted); // if shown-when-sorted, the kept file stays → advance past it
}

function markSorted(filePath) {
  sortedSet.add(filePath);
  if (!sortedState[folder]) sortedState[folder] = {};
  sortedState[folder][filePath] = true;
  saveConfig();
}

function advanceAfterDecision(keptVisible) {
  refreshVisible();
  if (keptVisible) index += 1; // decided file is still in the list → step to the next
  // else: the decided file left the list, so the next one slides into the current index
  if (index > files.length - 1) index = files.length - 1;
  if (index < 0) index = 0;
  render();
}

function unmarkSorted(filePath) {
  sortedSet.delete(filePath);
  if (sortedState[folder]) delete sortedState[folder][filePath];
  saveConfig();
}

// Reverse the last decision (move → move the file back; keep → un-mark Sorted).
async function undo() {
  if (acting) return;
  if (undoStack.length === 0) {
    toast('Nothing to undo');
    return;
  }
  const entry = undoStack.pop();

  if (entry.type === 'keep') {
    unmarkSorted(entry.file.path);
    refreshVisible();
    index = Math.max(0, files.indexOf(entry.file));
    render();
    toast('Undid keep');
    return;
  }

  // move: put the file back into its source folder (collision-safe)
  acting = true;
  let restored;
  try {
    restored = await api.moveFile(entry.toPath, entry.dir);
  } catch (err) {
    undoStack.push(entry); // keep it so the user can retry
    toast(`Undo failed: ${err.message}`);
    acting = false;
    return;
  }
  unmarkSorted(entry.file.path);
  entry.file.path = restored; // may differ if the original name was taken again
  allFiles.push(entry.file);
  sortFiles();
  refreshVisible();
  index = Math.max(0, files.indexOf(entry.file));
  render();
  toast('Undid move');
  acting = false;
}

// --- key → directory bindings ---

function dirLabel(dir) {
  const parts = dir.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : dir;
}

function keyDisplay(key) {
  if (key === ' ') return 'Space';
  return key.length === 1 ? key.toUpperCase() : key;
}

function renderBindings() {
  bindingsEl.replaceChildren();
  bindingsEl.appendChild(makeChip({
    key: keepKey,
    label: 'Keep',
    removable: false,
    onRebind: startRebindKeep,
  }));
  for (const binding of bindings) {
    bindingsEl.appendChild(makeChip({
      key: binding.key,
      label: dirLabel(binding.dir),
      title: binding.dir,
      removable: true,
      onRebind: () => startRebindDir(binding),
      onRemove: () => removeBinding(binding),
    }));
  }
}

function makeChip({ key, label, title, removable, onRebind, onRemove }) {
  const chip = document.createElement('div');
  chip.className = 'chip';
  if (title) chip.title = title;

  const keyBadge = document.createElement('button');
  keyBadge.type = 'button';
  keyBadge.className = 'chip__key';
  keyBadge.textContent = keyDisplay(key);
  keyBadge.title = 'Click to rebind key';
  keyBadge.addEventListener('click', onRebind);
  chip.appendChild(keyBadge);

  const labelEl = document.createElement('span');
  labelEl.className = 'chip__label';
  labelEl.textContent = label;
  chip.appendChild(labelEl);

  if (removable) {
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'chip__remove';
    rm.textContent = '×';
    rm.title = 'Remove binding';
    rm.addEventListener('click', onRemove);
    chip.appendChild(rm);
  }
  return chip;
}

function removeBinding(binding) {
  bindings = bindings.filter((b) => b !== binding);
  saveConfig();
  renderBindings();
}

async function startAddBinding() {
  if (capture) return;
  const dir = await api.pickFolder();
  if (!dir) return;
  capture = { type: 'add', dir };
  showCaptureHint(`Press a key to bind to "${dirLabel(dir)}" — Esc to cancel`);
}

function startRebindKeep() {
  if (capture) return;
  capture = { type: 'rebind-keep' };
  showCaptureHint('Press a new key for Keep — Esc to cancel');
}

function startRebindDir(binding) {
  if (capture) return;
  capture = { type: 'rebind-dir', binding };
  showCaptureHint(`Press a new key for "${dirLabel(binding.dir)}" — Esc to cancel`);
}

function showCaptureHint(text) {
  captureHintEl.textContent = text;
  captureHintEl.hidden = false;
}

function endCapture() {
  capture = null;
  captureHintEl.hidden = true;
}

function normalizeKey(key) {
  return key.length === 1 ? key.toLowerCase() : key;
}

// Is `key` already bound? `exclude` is 'keep' or a binding object to ignore (when rebinding it).
function keyInUse(key, exclude) {
  if (exclude !== 'keep' && key === keepKey) return true;
  return bindings.some((b) => b !== exclude && b.key === key);
}

function handleCaptureKey(event) {
  event.preventDefault();
  const rawKey = event.key;
  if (rawKey === 'Escape') { endCapture(); return; }
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(rawKey)) return; // wait for a real key
  if (RESERVED_KEYS.has(rawKey)) {
    showCaptureHint('That key is reserved for navigation — pick another.');
    return;
  }

  const key = normalizeKey(rawKey);
  const taken = (excl) => {
    if (keyInUse(key, excl)) {
      showCaptureHint(`"${keyDisplay(key)}" is already bound — pick another.`);
      return true;
    }
    return false;
  };

  if (capture.type === 'add') {
    if (taken()) return;
    bindings.push({ key, dir: capture.dir });
  } else if (capture.type === 'rebind-keep') {
    if (taken('keep')) return;
    keepKey = key;
  } else if (capture.type === 'rebind-dir') {
    if (taken(capture.binding)) return;
    capture.binding.key = key;
  }

  endCapture();
  saveConfig();
  renderBindings();
}

function saveConfig() {
  api.setConfig({ keepKey, bindings, includeSorted, sorted: sortedState, sortMode, lastFolder, theme });
}

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 900);
}

// Keyboard: capture a binding key if capturing; else navigate (arrows) or act (keep / bound key).
window.addEventListener('keydown', (event) => {
  if (capture) {
    handleCaptureKey(event);
    return;
  }
  // Undo must work even when the list is empty and takes priority over a bound "z".
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    undo();
    return;
  }
  if (acting) return; // ignore input while a move is in flight
  if (files.length === 0) return;

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    index = Math.min(index + 1, files.length - 1);
    render();
    return;
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    index = Math.max(index - 1, 0);
    render();
    return;
  }

  const key = normalizeKey(event.key);
  if (key === keepKey) {
    event.preventDefault();
    keepCurrent();
    return;
  }
  const binding = bindings.find((b) => b.key === key);
  if (binding) {
    event.preventDefault();
    moveCurrent(binding);
  }
});
