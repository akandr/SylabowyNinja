// Bootstrap: menu → game.

import { SETS } from './syllables.js?v=79';
import { initTTS, setMuted, isMuted, unlockAudio } from './tts.js?v=79';
import { initGame, startGame, stopGame, setMusicVolume } from './game.js?v=79';
import { setSfxMuted, setSfxVolume } from './sfx.js?v=79';

const menu = document.getElementById('menu');
const gameScreen = document.getElementById('game');
const setList = document.getElementById('set-list');
const startBtn = document.getElementById('start-btn');
const muteBtn = document.getElementById('mute-btn');
const backBtn = document.getElementById('back-btn');
const loadingMenuBtn = document.getElementById('loading-menu-btn');

const selected = new Set();

function buildMenu() {
  setList.innerHTML = '';
  for (const [id, set] of Object.entries(SETS)) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = id;
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(id); else selected.delete(id);
      startBtn.disabled = selected.size === 0;
    });
    const title = document.createElement('div');
    title.innerHTML = `<div class="items">${set.label}</div>`;
    label.append(cb, title);
    setList.append(label);
  }
  // Pre-select the first set for convenience.
  const first = setList.querySelector('input[type=checkbox]');
  if (first) { first.checked = true; selected.add(first.value); startBtn.disabled = false; }
}

function showMenu() {
  stopGame();
  menu.classList.remove('hidden');
  gameScreen.classList.add('hidden');
}

function showGame() {
  menu.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  startGame([...selected], {
    noReveal:  !!(optNoReveal  && optNoReveal.checked),
    noEnemies: !!(optNoEnemies && optNoEnemies.checked),
    easy:      !!(optEasy      && optEasy.checked),
  });
}

startBtn.addEventListener('click', () => {
  if (selected.size) {
    // Grant the page autoplay permission while we still hold a user-gesture
    // activation token. Without this, on Firefox Android (and others) the
    // first speakOnce() call after the async prefetchAll await is rejected
    // by the autoplay policy and falls back to speech synthesis.
    unlockAudio();
    showGame();
  }
});

// Difficulty toggles — persist across sessions.
const optNoReveal  = document.getElementById('opt-no-reveal');
const optNoEnemies = document.getElementById('opt-no-enemies');
const optEasy      = document.getElementById('opt-easy');
if (optNoReveal) {
  optNoReveal.checked = localStorage.getItem('noReveal') === '1';
  optNoReveal.addEventListener('change', () => {
    localStorage.setItem('noReveal', optNoReveal.checked ? '1' : '0');
  });
}
if (optNoEnemies) {
  optNoEnemies.checked = localStorage.getItem('noEnemies') === '1';
  optNoEnemies.addEventListener('change', () => {
    localStorage.setItem('noEnemies', optNoEnemies.checked ? '1' : '0');
  });
}
if (optEasy) {
  optEasy.checked = localStorage.getItem('easy') === '1';
  optEasy.addEventListener('change', () => {
    localStorage.setItem('easy', optEasy.checked ? '1' : '0');
  });
}
backBtn.addEventListener('click', showMenu);
if (loadingMenuBtn) loadingMenuBtn.addEventListener('click', () => {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.add('hidden');
  showMenu();
});
muteBtn.addEventListener('click', () => {
  const next = !isMuted();
  setMuted(next);
  setSfxMuted(next);
  muteBtn.textContent = next ? '🔇' : '🔊';
});

// Audio sliders in the menu — persist values in localStorage so the kid's
// preferred levels stick across sessions.
const musicSlider = document.getElementById('music-vol');
const sfxSlider   = document.getElementById('sfx-vol');
if (musicSlider) {
  const saved = parseFloat(localStorage.getItem('musicVol'));
  if (Number.isFinite(saved)) musicSlider.value = String(saved);
  setMusicVolume(musicSlider.value / 100);
  musicSlider.addEventListener('input', () => {
    const v = musicSlider.value / 100;
    setMusicVolume(v);
    localStorage.setItem('musicVol', musicSlider.value);
  });
}
if (sfxSlider) {
  const saved = parseFloat(localStorage.getItem('sfxVol'));
  if (Number.isFinite(saved)) sfxSlider.value = String(saved);
  setSfxVolume(sfxSlider.value / 100);
  sfxSlider.addEventListener('input', () => {
    const v = sfxSlider.value / 100;
    setSfxVolume(v);
    localStorage.setItem('sfxVol', sfxSlider.value);
  });
}

// Fullscreen toggle. Pressing F11 or the OS gesture also works, but a
// dedicated button is friendlier on a tablet/phone where the user has no
// keyboard. Standard Fullscreen API; falls back silently if unsupported.
const fsBtn = document.getElementById('fullscreen-btn');
if (fsBtn) {
  fsBtn.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (_) { /* user gesture timing or unsupported — ignore */ }
  });
  document.addEventListener('fullscreenchange', () => {
    fsBtn.textContent = document.fullscreenElement ? '⛶ Wyjśdź' : '⛶ Pełny ekran';
  });
}

(async function boot() {
  buildMenu();
  await initTTS();
  await initGame();
})();
