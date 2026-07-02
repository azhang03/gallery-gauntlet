// Batch 3: open a folder, list its files, and render each one (image or file icon).
const api = window.galleryGauntlet;

const openBtn = document.getElementById('open-btn');
const folderPathEl = document.getElementById('folder-path');
const positionEl = document.getElementById('position');
const emptyEl = document.getElementById('empty');
const fileViewEl = document.getElementById('file-view');
const fileDisplayEl = document.getElementById('file-display');
const fileNameEl = document.getElementById('file-name');

// Extensions Chromium can render inline. Everything else (HEIC, RAW, docs, video…)
// falls back to a generic file icon.
const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.jfif', '.png', '.apng', '.gif',
  '.webp', '.bmp', '.svg', '.avif', '.ico',
]);

let files = [];
let index = 0;
let folder = null;

openBtn.addEventListener('click', openFolder);

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
  index = 0;
  render();
}

function showEmpty(message) {
  fileViewEl.hidden = true;
  emptyEl.hidden = false;
  emptyEl.textContent = message;
  positionEl.textContent = '';
}

function render() {
  if (files.length === 0) {
    showEmpty(folder ? 'No files in this folder.' : 'Open a folder to start sorting.');
    return;
  }

  emptyEl.hidden = true;
  fileViewEl.hidden = false;

  const file = files[index];
  fileDisplayEl.replaceChildren();

  if (IMAGE_EXTS.has(file.ext)) {
    const img = document.createElement('img');
    img.alt = file.name;
    img.src = `gg://img/?path=${encodeURIComponent(file.path)}`;
    // If the bytes can't actually be decoded, fall back to the generic icon.
    img.addEventListener('error', () => {
      fileDisplayEl.replaceChildren(makeIcon(file));
    });
    fileDisplayEl.appendChild(img);
  } else {
    fileDisplayEl.appendChild(makeIcon(file));
  }

  fileNameEl.textContent = file.name;
  positionEl.textContent = `${index + 1} / ${files.length}`;
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
  // Document outline with a folded top-right corner.
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

// Arrow keys step through the files, clamped at both ends (no wrap-around).
window.addEventListener('keydown', (event) => {
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
