'use strict';

// ─── Elements ─────────────────────────────────────────────────────────────────

const iconWrap     = document.getElementById('icon-wrap');
const statusBadge  = document.getElementById('status-badge');
const installedVer = document.getElementById('installed-ver');
const latestVer    = document.getElementById('latest-ver');
const progressWrap = document.getElementById('progress-wrap');
const progressFill = document.getElementById('progress-fill');
const progressLbl  = document.getElementById('progress-label');
const actionBtn    = document.getElementById('action-btn');
const logInner     = document.getElementById('log-inner');
const logWrap      = document.getElementById('log-wrap');
const logToggle    = document.getElementById('log-toggle');

// ─── State ────────────────────────────────────────────────────────────────────

let checkResult = null;
let busy = false;

// ─── Window controls ──────────────────────────────────────────────────────────

document.getElementById('btn-close').addEventListener('click', () => syncr.close());
document.getElementById('btn-min').addEventListener('click',   () => syncr.minimize());

// ─── Log ──────────────────────────────────────────────────────────────────────

logToggle.addEventListener('click', () => logWrap.classList.toggle('open'));

function appendLog(msg, isErr) {
  const line = document.createElement('div');
  line.className = 'log-line' + (isErr ? ' err' : '');
  line.textContent = '› ' + msg;
  logInner.appendChild(line);
  logInner.scrollTop = logInner.scrollHeight;

  if (!logWrap.classList.contains('open')) logWrap.classList.add('open');
}

syncr.onLog(msg => {
  const isErr = /error|fail|denied/i.test(msg);
  appendLog(msg, isErr);
});

// ─── Progress ─────────────────────────────────────────────────────────────────

syncr.onProgress(pct => {
  progressWrap.classList.add('visible');
  progressFill.style.width = (pct * 100).toFixed(1) + '%';
  progressLbl.textContent  = pct >= 1 ? 'Done!' : `${Math.round(pct * 100)}%`;
});

// ─── Status rendering ─────────────────────────────────────────────────────────

function semverGt(a, b) {
  if (!a || !b) return false;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

function applyState(result) {
  checkResult = result;
  const { hostExists, installedVersion, latestVersion, assets } = result;
  const hasUpdate = hostExists && semverGt(latestVersion, installedVersion);

  installedVer.textContent = installedVersion ? `v${installedVersion}` : '—';
  latestVer.textContent    = latestVersion     ? `v${latestVersion}`    : 'Unknown';

  if (!hostExists) {
    statusBadge.textContent  = 'Not installed';
    statusBadge.className    = 'badge badge-not-installed';
    actionBtn.textContent    = 'Install Syncr';
    actionBtn.disabled       = !assets?.host;
    actionBtn.className      = 'action-btn';
  } else if (hasUpdate) {
    statusBadge.textContent  = `Update available`;
    statusBadge.className    = 'badge badge-update';
    actionBtn.textContent    = `Update to v${latestVersion}`;
    actionBtn.disabled       = false;
    actionBtn.className      = 'action-btn';
  } else {
    statusBadge.textContent  = 'Up to date';
    statusBadge.className    = 'badge badge-installed';
    actionBtn.textContent    = '✓ Up to date';
    actionBtn.disabled       = true;
    actionBtn.className      = 'action-btn success';
  }
}

// ─── Initial check ────────────────────────────────────────────────────────────

async function runCheck() {
  statusBadge.textContent = 'Checking…';
  statusBadge.className   = 'badge badge-checking';
  actionBtn.disabled      = true;
  actionBtn.textContent   = 'Checking…';
  iconWrap.classList.add('spinning');

  const result = await syncr.check();
  iconWrap.classList.remove('spinning');
  applyState(result);
}

runCheck();

// ─── Action button ────────────────────────────────────────────────────────────

actionBtn.addEventListener('click', async () => {
  if (busy || !checkResult) return;
  busy = true;

  actionBtn.disabled    = true;
  actionBtn.textContent = 'Installing…';
  progressWrap.classList.add('visible');
  progressFill.style.width = '0%';
  progressLbl.textContent  = 'Starting…';
  iconWrap.classList.add('spinning');

  const result = await syncr.install({ assets: checkResult.assets });

  iconWrap.classList.remove('spinning');
  busy = false;

  if (result?.ok) {
    progressLbl.textContent  = 'Done! Click "Add" in Firefox.';
    progressFill.style.width = '100%';
    actionBtn.textContent    = '✓ Installed — Add extension in Firefox';
    actionBtn.className      = 'action-btn success';
    actionBtn.disabled       = true;

    statusBadge.textContent = 'Installed';
    statusBadge.className   = 'badge badge-installed';
  } else {
    progressWrap.classList.remove('visible');
    actionBtn.textContent = 'Retry';
    actionBtn.disabled    = false;
    actionBtn.className   = 'action-btn';
    appendLog(result?.error || 'Unknown error', true);
  }
});
