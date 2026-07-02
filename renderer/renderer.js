// Batch 2: open a folder, list its files, and navigate them one at a time.
const api = window.galleryGauntlet;

const openBtn = document.getElementById('open-btn');
const folderPathEl = document.getElementById('folder-path');
const positionEl = document.getElementById('position');
const emptyEl = document.getElementById('empty');
const fileViewEl = document.getElementById('file-view');
const fileNameEl = document.getElementById('file-name');

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
  fileNameEl.textContent = file.name;
  positionEl.textContent = `${index + 1} / ${files.length}`;
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
