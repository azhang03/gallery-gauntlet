// Batch 3b: open a folder, list files, and render each one — image, video, or file icon.
const api = window.galleryGauntlet;

const openBtn = document.getElementById('open-btn');
const muteBtn = document.getElementById('mute-btn');
const folderPathEl = document.getElementById('folder-path');
const positionEl = document.getElementById('position');
const emptyEl = document.getElementById('empty');
const fileViewEl = document.getElementById('file-view');
const fileDisplayEl = document.getElementById('file-display');
const fileNameEl = document.getElementById('file-name');

// Extensions Chromium can render inline as images.
const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.jfif', '.png', '.apng', '.gif',
  '.webp', '.bmp', '.svg', '.avif', '.ico',
]);
// Video formats Electron/Chromium can decode. Others fall back to the file icon.
const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.mov']);

let files = [];
let index = 0;
let folder = null;
let isMuted = false; // persists across videos for the session

openBtn.addEventListener('click', openFolder);
muteBtn.addEventListener('click', toggleMute);

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
    // If the bytes can't be decoded, fall back to the generic icon.
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
    // Undecodable video (e.g. an HEVC clip with no OS decoder) → show a clear message.
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
