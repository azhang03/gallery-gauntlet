// Batch 5: open/sort/render files, plus configure key→directory bindings (bottom bar).
const api = window.galleryGauntlet;

const openBtn = document.getElementById('open-btn');
const sortSelect = document.getElementById('sort-select');
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

// Extensions Chromium can render inline as images.
const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.jfif', '.png', '.apng', '.gif',
  '.webp', '.bmp', '.svg', '.avif', '.ico',
]);
// Video formats Electron/Chromium can decode. Others fall back to the file icon.
const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.mov']);
// Keys the app owns, so they can't be bound to a directory.
const RESERVED_KEYS = new Set(['ArrowLeft', 'ArrowRight']);

let files = [];
let index = 0;
let folder = null;
let isMuted = false; // persists across videos for the session
let sortMode = 'date-desc'; // 'date-desc' | 'date-asc' | 'random'

// Bindings config (Batch 5). Pressing bound keys performs actions in Batch 6.
let keepKey = 'k';
let bindings = []; // [{ key, dir }]
let capture = null; // pending key capture: { type: 'add'|'rebind-keep'|'rebind-dir', dir?, binding? }

openBtn.addEventListener('click', openFolder);
muteBtn.addEventListener('click', toggleMute);
addBindingBtn.addEventListener('click', startAddBinding);
sortSelect.addEventListener('change', () => {
  sortMode = sortSelect.value;
  sortFiles();
  index = 0;
  render();
});

// Load persisted bindings on startup.
initConfig();
async function initConfig() {
  const cfg = await api.getConfig();
  keepKey = cfg.keepKey || 'k';
  bindings = Array.isArray(cfg.bindings) ? cfg.bindings : [];
  renderBindings();
}

// --- files: load / sort / navigate / render ---

async function openFolder() {
  const picked = await api.pickFolder();
  if (!picked) return; // canceled — leave current state untouched
  await loadFolder(picked);
}

async function loadFolder(folderPath) {
  folder = folderPath;
  folderPathEl.textContent = folderPath;
  try {
    files = await api.listFiles(folderPath);
  } catch (err) {
    files = [];
    index = 0;
    showEmpty(`Could not read folder: ${err.message}`);
    return;
  }
  sortFiles();
  index = 0;
  render();
}

// Reorder `files` in place per the current sort mode.
function sortFiles() {
  if (sortMode === 'date-asc') {
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  } else if (sortMode === 'date-desc') {
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  } else if (sortMode === 'random') {
    for (let i = files.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [files[i], files[j]] = [files[j], files[i]];
    }
  }
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
    showEmpty(folder ? 'No files in this folder.' : 'Open a folder to start sorting.');
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

// --- key → directory bindings (config only in Batch 5) ---

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
  api.setConfig({ keepKey, bindings });
}

// Keyboard: capture a binding key if capturing; otherwise navigate with the arrows.
window.addEventListener('keydown', (event) => {
  if (capture) {
    handleCaptureKey(event);
    return;
  }
  if (files.length === 0) return;
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    index = Math.min(index + 1, files.length - 1);
    render();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    index = Math.max(index - 1, 0);
    render();
  }
});
