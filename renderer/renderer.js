// Scaffold smoke test: prove the renderer <-> preload <-> main wiring works by
// reading version info exposed through the contextBridge preload.
const statusEl = document.getElementById('status');
const versionsEl = document.getElementById('versions');

const api = window.galleryGauntlet;

if (api && api.versions) {
  statusEl.textContent = 'Scaffold working — main ↔ preload ↔ renderer wired up. ✅';
  statusEl.classList.add('ok');

  const rows = [
    ['Electron', api.versions.electron],
    ['Node', api.versions.node],
    ['Chromium', api.versions.chrome],
  ];
  for (const [name, version] of rows) {
    const li = document.createElement('li');
    li.textContent = `${name}: ${version}`;
    versionsEl.appendChild(li);
  }
} else {
  statusEl.textContent =
    'Preload bridge NOT found — window.galleryGauntlet is undefined. ❌';
  statusEl.classList.add('err');
}
