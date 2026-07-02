'use strict';

const spinner    = document.getElementById('spinner');
const stepLabel  = document.getElementById('step-label');
const progTrack  = document.getElementById('prog-track');
const progFill   = document.getElementById('prog-fill');
const doneIcon   = document.getElementById('done-icon');
const doneTitle  = document.getElementById('done-title');
const doneLead   = document.getElementById('done-lead');
const errorBox   = document.getElementById('error-box');
const btnClose   = document.getElementById('btn-close-app');
const autostartToggle = document.getElementById('autostart-toggle');
const autostartCheck  = document.getElementById('autostart-check');

document.getElementById('btn-close').onclick = () => syncr.close();
document.getElementById('btn-min').onclick  = () => syncr.minimize();
btnClose.onclick = () => syncr.close();

autostartCheck.onchange = async () => {
  const enabled = await syncr.setAutostart(autostartCheck.checked);
  autostartCheck.checked = !!enabled;
};

syncr.onStep(msg => { stepLabel.textContent = msg; });
syncr.onProgress(p => {
  progTrack.classList.remove('hidden');
  progFill.style.width = Math.round(p * 100) + '%';
});

syncr.onPhase(phase => {
  if (phase === 'firefox') {
    spinner.classList.add('hidden');
    stepLabel.textContent = 'Waiting for you in Firefox…';
  }
  if (phase === 'done') {
    spinner.classList.add('hidden');
    progTrack.classList.add('hidden');
    stepLabel.classList.add('hidden');
    doneIcon.classList.remove('hidden');
    doneTitle.classList.remove('hidden');
    doneLead.classList.remove('hidden');
    autostartToggle.classList.remove('hidden');
    btnClose.classList.remove('hidden');

    // Reflect current autostart state and launch the tray now so the user can
    // immediately confirm the status icon is working.
    syncr.getAutostart().then(on => { autostartCheck.checked = !!on; }).catch(() => {});
    syncr.startTray().catch(() => {});
  }
  if (phase === 'error') {
    spinner.classList.add('hidden');
    progTrack.classList.add('hidden');
  }
});

(async () => {
  const res = await syncr.autoSetup();
  if (!res?.ok) {
    errorBox.textContent = res?.error || 'Setup failed.';
    errorBox.classList.remove('hidden');
    btnClose.textContent = 'Close';
    btnClose.classList.remove('hidden');
  }
})();
