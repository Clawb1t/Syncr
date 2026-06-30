'use strict';

const logoRing    = document.getElementById('logo-ring');
const statusChip  = document.getElementById('status-chip');
const installedV  = document.getElementById('installed-ver');
const latestV     = document.getElementById('latest-ver');
const progBox     = document.getElementById('prog-box');
const progFill    = document.getElementById('prog-fill');
const progLabel   = document.getElementById('prog-label');
const progPct     = document.getElementById('prog-pct');
const actionBtn   = document.getElementById('action-btn');
const logCard     = document.getElementById('log-card');
const logScroll   = document.getElementById('log-scroll');

document.getElementById('btn-close').onclick = () => syncr.close();
document.getElementById('btn-min').onclick   = () => syncr.minimize();
document.getElementById('log-head').onclick  = () => logCard.classList.toggle('open');

// ── Log ────────────────────────────────────────────────────────────────────

function appendLog(msg) {
  const isErr = /error|fail|denied/i.test(msg);
  const el = document.createElement('div');
  el.className = 'log-line' + (isErr ? ' err' : '');
  el.textContent = '› ' + msg;
  logScroll.appendChild(el);
  logScroll.scrollTop = logScroll.scrollHeight;
  if (!logCard.classList.contains('open')) logCard.classList.add('open');
}

syncr.onLog(appendLog);

// ── Progress ───────────────────────────────────────────────────────────────

syncr.onProgress(p => {
  progBox.classList.remove('hidden');
  const pct = Math.round(p * 100);
  progFill.style.width  = pct + '%';
  progPct.textContent   = pct + '%';
  if (p >= 1) progLabel.textContent = 'Complete!';
});

// ── Helpers ────────────────────────────────────────────────────────────────

function semverGt(a, b) {
  if (!a || !b) return false;
  return a.split('.').map(Number).reduce((acc, n, i) => {
    const bn = (b.split('.').map(Number)[i] || 0);
    return acc === 0 ? (n > bn ? 1 : n < bn ? -1 : 0) : acc;
  }, 0) > 0;
}

function setChip(text, cls) {
  statusChip.textContent = text;
  statusChip.className   = 'chip ' + cls;
}

// ── State ──────────────────────────────────────────────────────────────────

let state = null;

function applyState(s) {
  state = s;
  const { hostExists, installedVersion, latestVersion, assets } = s;
  const hasUpdate = hostExists && semverGt(latestVersion, installedVersion);
  const noAssets  = !assets?.host;

  installedV.textContent = installedVersion ? 'v' + installedVersion : '—';
  latestV.textContent    = latestVersion    ? 'v' + latestVersion    : 'Unknown';

  if (!hostExists) {
    setChip('Not installed', 'chip-red');
    actionBtn.textContent = 'Install Syncr';
    actionBtn.disabled    = noAssets;
    actionBtn.className   = 'btn btn-primary';
  } else if (hasUpdate) {
    setChip('Update available', 'chip-yellow');
    actionBtn.textContent = 'Update to v' + latestVersion;
    actionBtn.disabled    = false;
    actionBtn.className   = 'btn btn-primary';
  } else {
    setChip('Up to date', 'chip-green');
    actionBtn.textContent = '✓  Up to date';
    actionBtn.disabled    = true;
    actionBtn.className   = 'btn btn-done';
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────

logoRing.classList.add('spin');

syncr.check().then(s => {
  logoRing.classList.remove('spin');
  applyState(s);
});

// ── Install / Update ───────────────────────────────────────────────────────

let busy = false;
actionBtn.addEventListener('click', async () => {
  if (busy || !state) return;
  busy = true;
  logoRing.classList.add('spin');
  actionBtn.disabled    = true;
  actionBtn.textContent = 'Installing…';
  progBox.classList.remove('hidden');
  progFill.style.width  = '0%';
  progLabel.textContent = 'Starting…';
  progPct.textContent   = '0%';

  const res = await syncr.install({ assets: state.assets });
  logoRing.classList.remove('spin');
  busy = false;

  if (res?.ok) {
    setChip('Installed', 'chip-green');
    actionBtn.textContent = '✓  Done — click Add in Firefox';
    actionBtn.className   = 'btn btn-done';
    progLabel.textContent = 'All done!';
  } else {
    actionBtn.textContent = 'Retry';
    actionBtn.disabled    = false;
    actionBtn.className   = 'btn btn-primary';
    appendLog('Failed: ' + (res?.error || 'unknown error'));
  }
});
