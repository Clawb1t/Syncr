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

document.getElementById('btn-close').onclick = () => syncr.close();
document.getElementById('btn-min').onclick  = () => syncr.minimize();
btnClose.onclick = () => syncr.close();

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
    btnClose.classList.remove('hidden');
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
