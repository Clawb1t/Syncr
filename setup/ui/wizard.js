'use strict';

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const els = {
  checkNode:       document.getElementById('check-node'),
  alreadyInstalled:document.getElementById('already-installed'),
  btnInstall:      document.getElementById('btn-install'),
  btnInstallText:  document.getElementById('btn-install-text'),
  installStatus:   document.getElementById('install-status'),
  installError:    document.getElementById('install-error'),

  cardStep2:       document.getElementById('card-step-2'),
  extensionPath:   document.getElementById('extension-path'),
  copyPath:        document.getElementById('copy-path'),
  btnDoneExt:      document.getElementById('btn-done-ext'),

  cardStep3:       document.getElementById('card-step-3'),

  stepDots:        document.querySelectorAll('.progress-step'),
  lines:           [document.getElementById('line-1-2'), document.getElementById('line-2-3')],
};

// ---------------------------------------------------------------------------
// Progress tracker
// ---------------------------------------------------------------------------

function setStep(n) {
  els.stepDots.forEach((dot, i) => {
    dot.classList.remove('active', 'done');
    const stepNum = i + 1;
    if (stepNum < n)  dot.classList.add('done');
    if (stepNum === n) dot.classList.add('active');

    // Replace number with checkmark in done steps
    const bubble = dot.querySelector('.step-bubble');
    if (stepNum < n) {
      bubble.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor" style="width:12px;height:12px"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>`;
    } else {
      bubble.textContent = stepNum;
    }
  });

  els.lines.forEach((line, i) => {
    line.classList.toggle('filled', i + 2 <= n);
  });
}

// ---------------------------------------------------------------------------
// Step 1 — Install
// ---------------------------------------------------------------------------

async function init() {
  const status = await api('/api/status');

  // Node check
  setCheckRow(els.checkNode,
    status.nodeOk ? 'ok' : 'fail',
    status.nodeOk
      ? `Node.js ${status.nodeVersion} detected`
      : `Node.js 16+ required — ${status.nodeVersion ? `found ${status.nodeVersion}` : 'not found'}. Install from nodejs.org`,
    status.nodeOk ? null : 'nodejs.org'
  );

  if (status.isRegistered) {
    els.alreadyInstalled.classList.remove('hidden');
    els.btnInstallText.textContent = 'Reinstall / Update';
  }

  if (status.extensionPath) {
    els.extensionPath.textContent = status.extensionPath;
  }

  if (status.nodeOk) {
    els.btnInstall.disabled = false;
  }
}

function setCheckRow(row, state, text, linkHref) {
  const icon = row.querySelector('.check-icon');
  const textEl = row.querySelector('.check-text');
  icon.className = `check-icon ${state}`;
  if (linkHref) {
    textEl.innerHTML = `${text} — <a href="${linkHref}" target="_blank" style="color:var(--text-link)">${linkHref}</a>`;
  } else {
    textEl.textContent = text;
  }
}

els.btnInstall.addEventListener('click', async () => {
  els.btnInstall.disabled = true;
  els.installError.classList.add('hidden');
  setInlineStatus(els.installStatus, 'busy', 'Installing…');
  els.btnInstallText.textContent = 'Installing…';

  const result = await api('/api/install', 'POST');

  if (result.success) {
    setInlineStatus(els.installStatus, 'ok', 'Installed successfully');
    els.btnInstallText.textContent = 'Installed ✓';
    setTimeout(() => unlockStep2(), 600);
  } else {
    els.btnInstall.disabled = false;
    els.btnInstallText.textContent = 'Retry';
    setInlineStatus(els.installStatus, 'error', 'Installation failed');
    els.installError.classList.remove('hidden');
    els.installError.textContent = result.error;
  }
});

// ---------------------------------------------------------------------------
// Step 2 — Extension
// ---------------------------------------------------------------------------

function unlockStep2() {
  setStep(2);
  els.cardStep2.classList.add('unlocked');
  els.cardStep2.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

els.copyPath.addEventListener('click', async () => {
  const text = els.extensionPath.textContent;
  try {
    await navigator.clipboard.writeText(text);
    els.copyPath.style.color = 'var(--green)';
    setTimeout(() => { els.copyPath.style.color = ''; }, 1500);
  } catch {}
});

document.getElementById('about-debugging-link').addEventListener('click', (e) => {
  e.preventDefault();
  // Can't open about:debugging from a regular page, just show a tip
  const el = e.target;
  el.textContent = 'about:debugging (type this in the address bar)';
  setTimeout(() => { el.textContent = 'about:debugging'; }, 3000);
});

els.btnDoneExt.addEventListener('click', () => {
  unlockStep3();
});

// ---------------------------------------------------------------------------
// Step 3 — Done
// ---------------------------------------------------------------------------

function unlockStep3() {
  setStep(3);
  els.cardStep3.classList.add('unlocked');
  els.cardStep3.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function setInlineStatus(el, state, text) {
  el.className = `inline-status ${state}`;
  el.textContent = text;
}

async function api(path, method = 'GET') {
  try {
    const res = await fetch(path, { method });
    return res.json();
  } catch (err) {
    return { error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

init();
