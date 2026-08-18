'use strict';
let current = 1;

function updateDots() {
  document.querySelectorAll('.steps i').forEach((d, i) => {
    d.classList.toggle('on', i < current);
  });
}

function go(n) {
  current = n;
  history.replaceState(null, '', '#step-' + n);
  updateDots();
  document.querySelectorAll('.step').forEach((s) => s.classList.remove('active'));
  document.getElementById('step-' + n).classList.add('active');
}

function openUrl(url) {
  window.welcomeAPI.openUrl(url);
}

function finish() {
  window.welcomeAPI.done();
}

const requestedStep = Number(location.hash.match(/^#step-([1-3])$/)?.[1] || 1);
go(requestedStep);
