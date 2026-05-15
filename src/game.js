// Main game state, loop, and camera.

import { createMaze, drawMaze, TILE } from './maze.js?v=79';
import { createPlayer, updatePlayer, drawPlayer } from './player.js?v=79';
import { createInput } from './input.js?v=79';
import { spawnCollectibles, checkPickup, respawnCollectible, drawCollectibles } from './collectibles.js?v=79';
import { resolveItems, pickRandom, sameSound } from './syllables.js?v=79';
import { setTarget, clearTarget, speakOnce, prefetchAll, holdTarget, noteActivity, speakWithHold, getAudioContext as ttsGetAudioContext } from './tts.js?v=79';
import { loadSprites } from './sprites.js?v=79';
import { spawnGood, spawnBad, spawnPop, updateEffects, drawEffects, clearEffects } from './effects.js?v=79';
import { placeHouse, drawHouse } from './house.js?v=79';
import { spawnEnemies, updateEnemies, drawEnemies, checkEnemyHit, knockbackEnemy, eatEnemy } from './enemies.js?v=79';
import { createDiamondState, updateDiamond, checkDiamondPickup, consumeDiamond, drawDiamond } from './diamond.js?v=79';
import { createFreezeState, updateFreeze, checkFreezePickup, consumeFreeze, drawFreeze } from './freeze.js?v=79';
import { preloadSfx, playSfx, setSfxMuted } from './sfx.js?v=79';

const WIN_SCORE = 100;

// Diamond power-up: how long enemies stay edible after pickup, and how
// long the green sprite blinks at the end as a "running out" warning.
const POWER_DURATION_S = 12;
const POWER_BLINK_AT_S = 3;

// Freeze (ice scroll) power-up: enemies stand still for this many seconds.
const FREEZE_DURATION_S = 60;
const FREEZE_BLINK_AT_S = 5;

// Combo tracking is purely cosmetic now: a streak count is shown in the HUD
// past COMBO_THRESHOLD, but every correct pickup is always worth 1 point.
// (Earlier versions awarded 2 pts past the threshold; that confused the kid
// when the score jumped by 2 instead of 1.)
const COMBO_THRESHOLD = 5;

// Enemy speed scaling — gentle ramp from 1.0× to 1.6× over the first 90 s.
const SPEED_RAMP_END_S = 90;
const SPEED_RAMP_MAX = 1.6;

// Background ambient music — soft loop while the game is running. Volume is
// kept low so it never competes with the spoken syllables (the whole point
// of the game). Loaded lazily so the menu screen stays silent.
let musicVolume = 0.15;
let musicBuffer = null;
let musicSource = null;
let musicGain = null;
let ambienceBuffers = new Map();

export function setMusicVolume(v) {
  musicVolume = Math.max(0, Math.min(1, v));
  if (musicGain) musicGain.gain.value = musicVolume;
}

// Decode background music and ambience into AudioBuffers via Web Audio.
// Played through the shared AudioContext so a single user-gesture unlock
// (in unlockAudio()) primes everything — bypasses mobile <audio> autoplay
// restrictions (Firefox Android in particular).
async function preloadMusic() {
  const ctx = ttsGetAudioContext();
  if (!ctx) return false;
  async function decode(url) {
    try {
      const r = await fetch(url, { cache: 'force-cache' });
      if (!r.ok) return null;
      const bytes = await r.arrayBuffer();
      return await new Promise((resolve, reject) => {
        try {
          const p = ctx.decodeAudioData(bytes.slice(0), resolve, reject);
          if (p && typeof p.then === 'function') p.then(resolve, reject);
        } catch (e) { reject(e); }
      });
    } catch (_) { return null; }
  }
  try {
    if (!musicBuffer) musicBuffer = await decode('audio/forest_ambient.ogg');
    for (const cfg of AMBIENCE) {
      if (!ambienceBuffers.has(cfg.src)) {
        const buf = await decode(cfg.src);
        if (buf) ambienceBuffers.set(cfg.src, buf);
      }
    }
    return !!musicBuffer;
  } catch (_) { return false; }
}
// Random ambience — wind gusts and bird chirps layered on top of the music
// at low volume, scheduled at random intervals to feel alive.
const AMBIENCE = [
  { src: 'audio/wind.ogg', volume: 0.12, minGapMs: 12000, maxGapMs: 25000 },
  { src: 'audio/bird.ogg', volume: 0.18, minGapMs:  5000, maxGapMs: 15000 },
];
let ambienceTimers = [];
function startMusic() {
  const ctx = ttsGetAudioContext();
  if (!ctx || !musicBuffer) return;
  // Stop any previous instance (in case startGame is called twice).
  if (musicSource) { try { musicSource.stop(); } catch (_) {} musicSource = null; }
  musicGain = ctx.createGain();
  musicGain.gain.value = musicVolume;
  musicGain.connect(ctx.destination);
  musicSource = ctx.createBufferSource();
  musicSource.buffer = musicBuffer;
  musicSource.loop = true;
  musicSource.connect(musicGain);
  try { musicSource.start(0); } catch (_) {}
  startAmbience();
}
function stopMusic() {
  if (musicSource) { try { musicSource.stop(); } catch (_) {} musicSource = null; }
  stopAmbience();
}
// Schedules each ambience source on its own randomized timer; cleared by
// stopAmbience(). New Audio() per shot so overlapping plays work cleanly.
function startAmbience() {
  stopAmbience();
  const ctx = ttsGetAudioContext();
  if (!ctx) return;
  for (const cfg of AMBIENCE) {
    const buf = ambienceBuffers.get(cfg.src);
    if (!buf) continue;
    const schedule = () => {
      const delay = cfg.minGapMs + Math.random() * (cfg.maxGapMs - cfg.minGapMs);
      const id = setTimeout(() => {
        if (!running) return;
        try {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          const g = ctx.createGain();
          g.gain.value = cfg.volume;
          src.connect(g).connect(ctx.destination);
          src.start(0);
        } catch (_) {}
        schedule();
      }, delay);
      ambienceTimers.push(id);
    };
    schedule();
  }
}
function stopAmbience() {
  for (const id of ambienceTimers) clearTimeout(id);
  ambienceTimers = [];
}

// Scale the world to the chosen syllable pool: more sets → bigger map, more
// tiles, more enemies, so the items spread out and the game stays fun.
function levelParamsFor(itemCount) {
  if (itemCount >= 30) {
    return { cols: 60, rows: 36, collectibles: 64, enemies: 5, density: 0.18 };
  }
  if (itemCount >= 12) {
    return { cols: 48, rows: 28, collectibles: 40, enemies: 4, density: 0.18 };
  }
  return    { cols: 36, rows: 22, collectibles: 24, enemies: 3, density: 0.18 };
}

let canvas, ctx, input;
let maze, player, collectibles, house, enemies;
let diamond;            // diamond state (single power-up on the map)
let freeze;             // freeze state (single ice-scroll power-up on the map)
let poweredLeft = 0;    // seconds remaining of "enemies are scared" state
let frozenLeft = 0;     // seconds remaining of "enemies are frozen" state
let combo = 0;          // consecutive correct pickups
let maxCombo = 0;       // peak combo during the run
let correctPicks = 0;   // total correct syllable pickups
let mistakes = 0;       // total wrong syllable pickups
let enemyHits = 0;      // total enemy collisions while NOT powered/frozen
let enemiesEaten = 0;   // total enemies eaten in the powered state
let safe = new Set();
let items = [];
let target = null;
let score = 0;
let running = false;
let paused = false;
let pauseStart = 0;     // performance.now() when paused, used to shift runStart on resume
let lastT = 0;
let timeAcc = 0;
let runStart = 0;       // performance.now() at startGame; used for the on-screen timer
let runElapsedFinal = 0; // frozen elapsed time at win, in seconds
let elTarget, elScore, elTimer, elProgress, elCombo, elWin, elWinTime, elWinStats;

export async function initGame() {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  // Disable smoothing globally and persistently. Setting this only inside
  // drawSprite's save/restore was insufficient: the canvas default (true)
  // would re-apply between draws and cause neighbouring 16x16 sprite cells
  // to bleed into the player at sub-pixel scroll offsets, making the player
  // appear to "rotate" through directions while walking.
  ctx.imageSmoothingEnabled = false;
  elTarget = document.getElementById('target');
  elScore = document.getElementById('score');
  elTimer = document.getElementById('timer');
  elProgress = document.getElementById('progress-fill');
  elCombo = document.getElementById('combo');
  elWin = document.getElementById('win-screen');
  elWinTime = document.getElementById('win-time');
  elWinStats = document.getElementById('win-stats');
  input = createInput();
  await loadSprites();
  preloadSfx();
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  // Reveal-on-demand: spacebar (or canvas tap) speaks the current target
  // and briefly flashes the syllable in the HUD. Otherwise the kid plays
  // by ear, which is the whole point of the game.
  window.addEventListener('keydown', (e) => {
    if (!running) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (paused) return;
      revealTarget();
    } else if (e.code === 'KeyP') {
      e.preventDefault();
      togglePause();
    } else if (e.code === 'KeyR') {
      e.preventDefault();
      resetPlayerToHome();
    }
  });
  if (canvas) {
    const onTap = (e) => {
      if (!running) return;
      e.preventDefault();
      if (paused) { togglePause(); return; }
      revealTarget();
    };
    canvas.addEventListener('click', onTap);
    canvas.addEventListener('touchstart', onTap, { passive: false });
  }
  // "Play again" from win screen returns to main menu.
  const winBtn = document.getElementById('win-again-btn');
  if (winBtn) winBtn.addEventListener('click', () => {
    if (elWin) elWin.classList.add('hidden');
    document.getElementById('game').classList.add('hidden');
    document.getElementById('menu').classList.remove('hidden');
  });
}

// How long the syllable stays visible after a reveal request.
const REVEAL_MS = 1800;
let revealTimer = null;
function revealTarget() {
  if (!target || !elTarget) return;
  speakOnce(target);
  noteActivity();
  // Visual flash is suppressed when the player has chosen "no visual hint";
  // they still get the audio, just no on-screen letters.
  if (options.noReveal) return;
  elTarget.classList.add('revealed');
  if (revealTimer) clearTimeout(revealTimer);
  revealTimer = setTimeout(() => {
    if (elTarget) elTarget.classList.remove('revealed');
    revealTimer = null;
  }, REVEAL_MS);
}

function resizeCanvas() {
  // We keep an internal resolution and CSS scales it; here we adapt to viewport ratio.
  const targetW = 960, targetH = 640;
  canvas.width = targetW;
  canvas.height = targetH;
}

function showAudioWarning(failed) {
  let banner = document.getElementById('audio-warn');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'audio-warn';
    banner.style.cssText =
      'position:fixed;top:60px;left:50%;transform:translateX(-50%);' +
      'background:rgba(200,40,40,0.92);color:#fff;padding:10px 22px;' +
      'border-radius:12px;font:bold 14px system-ui,sans-serif;z-index:999;' +
      'pointer-events:none;transition:opacity 600ms ease;max-width:90vw;text-align:center';
    document.body.appendChild(banner);
  }
  banner.textContent = `⚠ Nie udało się wczytać ${failed.length} plików audio — użyję syntezatora`;
  banner.style.opacity = '1';
  setTimeout(() => { banner.style.opacity = '0'; }, 6000);
}

// Active gameplay options for the current run, set by startGame().
let options = { noReveal: false, noEnemies: false, easy: false };

// Time of the last directional input (any of up/down/left/right pressed).
// Used by Easy mode to decide when to draw the "go this way" arrow above
// the player after a few seconds of idleness.
let lastMoveAt = 0;
const EASY_ARROW_IDLE_MS = 3500;

export async function startGame(setIds, opts = {}) {
  options = {
    noReveal:  !!opts.noReveal,
    noEnemies: !!opts.noEnemies,
    easy:      !!opts.easy,
  };
  // Resolve combined item list from selected sets.
  const merged = new Set();
  for (const id of setIds) for (const it of resolveItems(id)) merged.add(it);
  items = [...merged];
  if (items.length === 0) return;

  // --- Show loading overlay and prefetch ALL audio before the game starts ---
  const overlay = document.getElementById('loading-overlay');
  const loadFill = document.getElementById('loading-fill');
  const loadText = document.getElementById('loading-text');
  const loadDetail = document.getElementById('loading-detail');
  const loadCard = overlay ? overlay.querySelector('.loading-card') : null;
  const loadMenuBtn = document.getElementById('loading-menu-btn');
  if (overlay) overlay.classList.remove('hidden');
  if (loadCard) loadCard.classList.remove('failed');
  if (loadFill) loadFill.style.width = '0%';
  if (loadText) loadText.textContent = 'Ładowanie dźwięków…';
  if (loadDetail) loadDetail.textContent = '';
  if (loadMenuBtn) loadMenuBtn.textContent = '⏏ Anuluj';

  const { failed } = await prefetchAll(items, {
    onProgress({ loaded, total, attempt, maxAttempts }) {
      const pct = Math.round((loaded / total) * 100);
      if (loadFill) loadFill.style.width = pct + '%';
      if (attempt > 1 && loadDetail) {
        loadDetail.textContent = `Próba ${attempt}/${maxAttempts} — pozostało ${total - loaded}`;
      }
    }
  });

  // Preload music in parallel-after — non-blocking for the failed-check.
  // If it fails the game still starts (music just won't play).
  await preloadMusic();

  if (failed.length > 0) {
    // Don't start the game — show error in the overlay and let the user
    // return to menu. The Menu button is wired in main.js.
    if (loadCard) loadCard.classList.add('failed');
    if (loadText) loadText.textContent = '⚠ Nie udało się wczytać dźwięków';
    if (loadDetail) {
      loadDetail.textContent =
        `Brakuje ${failed.length} z ${items.length ? '…' : 0} plików. ` +
        `Sprawdź połączenie i spróbuj ponownie.`;
    }
    if (loadMenuBtn) loadMenuBtn.textContent = '⏏ Menu';
    return { aborted: true, failed };
  }

  // --- Build the level NOW so we know the target before the Graj click ---
  const params = levelParamsFor(items.length);
  maze = createMaze({ cols: params.cols, rows: params.rows, density: params.density });
  house = placeHouse(maze, 2, 2);
  player = createPlayer(house.spawn);
  const safeNew = safeZone(house.spawn, 4);
  safe = safeNew;
  collectibles = spawnCollectibles(maze, items, params.collectibles, safe);
  enemies = options.noEnemies ? [] : spawnEnemies(maze, params.enemies, house.spawn, safe);
  diamond = createDiamondState();
  freeze = createFreezeState();
  poweredLeft = 0;
  frozenLeft = 0;
  combo = 0;
  maxCombo = 0;
  correctPicks = 0;
  mistakes = 0;
  enemyHits = 0;
  enemiesEaten = 0;
  target = pickRandom(items);
  if (!collectibles.some(c => sameSound(c.text, target))) {
    collectibles[Math.floor(Math.random() * collectibles.length)].text = target;
  }
  score = 0;

  // Wait for a fresh user gesture before starting. The async prefetchAll
  // above can take many seconds — by the time it finishes, the original
  // Start-button activation token has expired in mobile browsers (esp.
  // Firefox Android), so the very first speakOnce() call would be rejected
  // by the autoplay policy and silently fall back to speech synthesis. A
  // dedicated "Graj" button gives us a guaranteed-fresh gesture and we play
  // the first syllable SYNCHRONOUSLY inside its click handler — that real,
  // unmuted .play() grants the page autoplay permission for the session.
  if (loadText) loadText.textContent = 'Gotowe!';
  if (loadDetail) loadDetail.textContent = '';
  if (loadMenuBtn) loadMenuBtn.textContent = '⏏ Menu';
  await new Promise(resolve => {
    let playBtn = document.getElementById('loading-play-btn');
    if (!playBtn) {
      playBtn = document.createElement('button');
      playBtn.id = 'loading-play-btn';
      playBtn.type = 'button';
      playBtn.className = 'loading-play-btn';
      if (loadCard) loadCard.appendChild(playBtn);
    }
    playBtn.textContent = '▶ Graj';
    playBtn.classList.remove('hidden');
    playBtn.onclick = () => {
      playBtn.classList.add('hidden');
      // CRITICAL: the very first audio playback must happen here, inside
      // the click handler, *unmuted*. This is the call that gets the
      // autoplay token from the user gesture. We can't await anything
      // before it — no microtasks, no promises, just play() calls now.
      try { speakOnce(target); } catch (_) {}
      try { startMusic(); } catch (_) {}
      resolve();
    };
  });
  if (overlay) overlay.classList.add('hidden');
  // --- End loading ---
  runStart = performance.now();
  runElapsedFinal = 0;
  updateHud();
  // speakImmediately:false — we already spoke the target inside the Graj
  // click handler (to get the autoplay activation token). The idle-nudge
  // timer will re-speak it 5s later if the player hasn't moved.
  setTarget(target, { speakImmediately: false });
  clearEffects();
  if (elWin) elWin.classList.add('hidden');
  // Music was already started inside the Graj click handler to claim the
  // autoplay token alongside the first speakOnce(target).

  running = true;
  paused = false;
  lastT = performance.now();
  lastMoveAt = lastT;
  requestAnimationFrame(loop);
}

export function stopGame() {
  running = false;
  clearTarget();
  clearEffects();
  stopMusic();
}

function ensureTargetOnBoard() {
  // Defensive guarantee: at any moment, at least one collectible on the
  // board must speak the current target (or a homophone). Called after
  // every action that re-rolls tile texts (correct pickup, wrong pickup,
  // new target). Prevents an unwinnable state where the kid hears a
  // syllable but no matching tile exists anywhere.
  if (!collectibles || !target) return;
  if (collectibles.some(c => sameSound(c.text, target))) return;
  const idx = Math.floor(Math.random() * collectibles.length);
  collectibles[idx].text = target;
}

// Build a Set of "tx,ty" cell keys within `radius` (Chebyshev distance) of
// `center`. Used to forbid spawning anything inside the house's safe zone.
function safeZone(center, radius) {
  const out = new Set();
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      out.add(`${center.x + dx},${center.y + dy}`);
    }
  }
  return out;
}

function newTarget({ delayMs = 0 } = {}) {
  target = pickRandom(items, target);
  // Make sure board contains at least one matching tile (homophones count);
  // if not, replace a random tile.
  if (!collectibles.some(c => sameSound(c.text, target))) {
    const idx = Math.floor(Math.random() * collectibles.length);
    collectibles[idx].text = target;
  }
  // Update HUD immediately so the kid sees the new target;
  // delay only the speech so it doesn't overlap with feedback ("brawo").
  updateHud();
  if (delayMs > 0) {
    setTarget(target, { speakImmediately: false });
    setTimeout(() => speakOnce(target), delayMs);
  } else {
    setTarget(target);
  }
  ensureTargetOnBoard();
}

// Teleport the player back to the house spawn. Used as an escape hatch
// (R key) when grid movement gets visually stuck — e.g. against a frozen
// enemy or in a corner where animation desyncs from the tile grid.
function resetPlayerToHome() {
  if (!player || !house) return;
  const sp = house.spawn;
  player.tx = sp.x;
  player.ty = sp.y;
  player.x = sp.x * TILE + TILE / 2;
  player.y = sp.y * TILE + TILE / 2;
  player.moving = false;
  player.moveDir = null;
  player.nextDir = null;
  player.targetTx = sp.x;
  player.targetTy = sp.y;
  player.facing = 'down';
}

function togglePause() {
  if (!running) return;
  if (!paused) {
    paused = true;
    pauseStart = performance.now();
    // Silence everything (syllable speech, sfx, music, ambience) by
    // suspending the shared AudioContext. Resume on unpause.
    try {
      const ac = ttsGetAudioContext();
      if (ac && ac.state === 'running') ac.suspend();
    } catch (_) {}
    drawPauseOverlay();
  } else {
    paused = false;
    try {
      const ac = ttsGetAudioContext();
      if (ac && ac.state === 'suspended') ac.resume();
    } catch (_) {}
    // Shift runStart forward by the paused duration so the on-screen timer
    // doesn't include the time spent paused.
    const pausedFor = performance.now() - pauseStart;
    runStart += pausedFor;
  }
}

function drawPauseOverlay() {
  if (!ctx || !canvas) return;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 56px system-ui, sans-serif';
  ctx.fillText('PAUZA', canvas.width / 2, canvas.height / 2 - 18);
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.fillText('Naciśnij P aby kontynuować', canvas.width / 2, canvas.height / 2 + 28);
  ctx.restore();
}

function winGame() {
  running = false;
  runElapsedFinal = (performance.now() - runStart) / 1000;
  if (elTimer) elTimer.textContent = formatTime(runElapsedFinal);
  if (elWinTime) elWinTime.textContent = formatTime(runElapsedFinal);
  if (elWinStats) {
    const accuracy = correctPicks + mistakes > 0
      ? Math.round(100 * correctPicks / (correctPicks + mistakes))
      : 100;
    elWinStats.innerHTML =
      `<li>Trafione sylaby: <b>${correctPicks}</b></li>` +
      `<li>Pomyłki: <b>${mistakes}</b></li>` +
      `<li>Celność: <b>${accuracy}%</b></li>` +
      `<li>Najdłuższa seria: <b>${maxCombo}</b> 🔥</li>` +
      `<li>Wrogowie zjedzeni: <b>${enemiesEaten}</b></li>` +
      `<li>Trafienia od wrogów: <b>${enemyHits}</b></li>`;
  }
  clearTarget();
  stopMusic();
  // Win speech ("brawo, 100 punktów!") is handled by the milestone path in
  // checkPickup() right before winGame() runs, using win.mp3.
  if (elWin) elWin.classList.remove('hidden');
}

function updateHud() {
  if (elTarget) elTarget.textContent = target ?? '…';
  if (elScore) elScore.textContent = String(score);
  if (elTimer) elTimer.textContent = formatTime(currentElapsed());
  if (elProgress) {
    const pct = Math.max(0, Math.min(100, (score / WIN_SCORE) * 100));
    elProgress.style.width = `${pct}%`;
  }
  if (elCombo) {
    if (combo >= COMBO_THRESHOLD) {
      elCombo.textContent = `🔥 ×${combo}`;
      elCombo.classList.add('active');
    } else {
      elCombo.textContent = '';
      elCombo.classList.remove('active');
    }
  }
}

function currentElapsed() {
  if (!running && runElapsedFinal > 0) return runElapsedFinal;
  if (!runStart) return 0;
  return (performance.now() - runStart) / 1000;
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function loop(now) {
  if (!running) return;
  if (paused) {
    // Keep the rAF chain alive so unpause resumes immediately, but skip
    // all game state updates and don't redraw (the pause overlay drawn
    // when togglePause() was called stays on screen).
    lastT = now;
    requestAnimationFrame(loop);
    return;
  }
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  timeAcc += dt;
  // Live timer in the HUD (cheap: integer-second updates only).
  if (elTimer) {
    const txt = formatTime(currentElapsed());
    if (elTimer.textContent !== txt) elTimer.textContent = txt;
  }

  updatePlayer(player, dt, input.dir, maze);
  // Track movement intent for Easy-mode idle arrow.
  if (input.dir.up || input.dir.down || input.dir.left || input.dir.right) {
    lastMoveAt = now;
  }
  // Enemies speed up gently with elapsed time, capped at SPEED_RAMP_MAX.
  const elapsed = currentElapsed();
  const ramp = Math.min(1, elapsed / SPEED_RAMP_END_S);
  const speedMul = 1 + (SPEED_RAMP_MAX - 1) * ramp;
  updateEnemies(enemies, dt, maze, player, { frozen: frozenLeft > 0, speedMul, noGo: safe });
  updateEffects(dt);

  // Power-ups: tick existing item / spawn timer; never spawn on a syllable
  // tile, in the safe zone, or where the other power-up already sits.
  const occupied = new Set([
    ...collectibles.map(c => `${c.tx},${c.ty}`),
    ...safe,
  ]);
  if (diamond.active) occupied.add(`${diamond.active.tx},${diamond.active.ty}`);
  if (freeze.active)  occupied.add(`${freeze.active.tx},${freeze.active.ty}`);
  // Detect a fresh power-up spawn so we can play a "ping" SFX exactly once.
  const diamondWas = !!diamond.active;
  const freezeWas  = !!freeze.active;
  // Power-ups only make sense when there are enemies to affect; skip both
  // their spawning and pickup when "no enemies" mode is on.
  if (!options.noEnemies) {
    updateDiamond(diamond, dt, maze, player, occupied);
    updateFreeze(freeze,  dt, maze, player, occupied);
  }
  if (!diamondWas && diamond.active) playSfx('spawn');
  if (!freezeWas  && freeze.active)  playSfx('freeze_spawn');
  // Detect power-up END (transition from >0 to 0) so we can play a single
  // "fades out" cue instead of leaving the kid wondering why squids are
  // suddenly dangerous again.
  const wasPowered = poweredLeft > 0;
  const wasFrozen  = frozenLeft  > 0;
  if (poweredLeft > 0) poweredLeft = Math.max(0, poweredLeft - dt);
  if (frozenLeft > 0)  frozenLeft  = Math.max(0, frozenLeft  - dt);
  if ((wasPowered && poweredLeft === 0) || (wasFrozen && frozenLeft === 0)) {
    playSfx('power_end');
  }

  // Pickup a diamond → powered state starts.
  if (checkDiamondPickup(diamond, player)) {
    consumeDiamond(diamond);
    poweredLeft = POWER_DURATION_S;
    spawnGood(player.x, player.y);
    // Distinct power-up SFX — no "brawo" voice (that's for syllables only).
    playSfx('power_diamond', { volumeMul: 1.1 });
  }
  // Pickup an ice scroll → frozen state starts.
  if (checkFreezePickup(freeze, player)) {
    consumeFreeze(freeze);
    frozenLeft = FREEZE_DURATION_S;
    spawnGood(player.x, player.y);
    playSfx('power_freeze', { volumeMul: 1.1 });
  }

  // Enemy collision — depends on whether we're powered or frozen.
  const eHit = checkEnemyHit(player, enemies);
  if (eHit >= 0) {
    const e = enemies[eHit];
    if (poweredLeft > 0) {
      // Eat it: small reward burst, despawn, will respawn far away.
      spawnGood(e.x, e.y);
      playSfx('eat');
      eatEnemy(e);
      enemiesEaten++;
    } else if (frozenLeft > 0) {
      // Frozen squids are harmless and the player passes through them.
      // (Don't manually nudge player.x/y here — the grid-movement system
      // assumes x/y are always aligned to tile centers when not sliding,
      // and a manual push causes a snap-back-collide-push loop.)
    } else {
      spawnBad(player.x, player.y);
      e.cooldown = 1.5;
      knockbackEnemy(e, player, maze);
      // Reset combo on a hit.
      combo = 0;
      enemyHits++;
      // "Aua!" yelp — hold target audio while it plays, then re-speak the
      // current target syllable so the kid is reminded what to look for.
      const hold = speakWithHold('aua', 300);
      setTimeout(() => { if (running) speakOnce(target); }, hold);
      // Teleport the hero home.
      player.x = house.spawn.x * TILE + TILE / 2;
      player.y = house.spawn.y * TILE + TILE / 2;
      player.tx = house.spawn.x;
      player.ty = house.spawn.y;
      player.targetTx = house.spawn.x;
      player.targetTy = house.spawn.y;
      player.moving = false;
      player.moveDir = null;
      player.nextDir = null;
      player.facing = 'down';
      updateHud();
    }
  }

  const hitIdx = checkPickup(player, collectibles);
  if (hitIdx >= 0) {
    noteActivity();
    const c = collectibles[hitIdx];
    const occupied = new Set(collectibles.map(x => `${x.tx},${x.ty}`));
    occupied.delete(`${c.tx},${c.ty}`);
    if (sameSound(c.text, target)) {
      // Track combo for the HUD streak indicator only — every correct
      // pickup is always worth exactly 1 point.
      combo += 1;
      if (combo > maxCombo) maxCombo = combo;
      correctPicks++;
      const points = 1;
      score += points;
      spawnGood(c.x, c.y);
      spawnPop(c.x, c.y, '#ffd84d');
      playSfx('pickup');
      // Respawn this tile, then deliver audio feedback.
      respawnCollectible(c, maze, items, occupied, safe, player);
      if (score >= WIN_SCORE) {
        updateHud();
        speakWithHold(`brawo, ${score} punktów!`, 600);
        winGame();
      } else if (Math.floor(score / 10) > Math.floor((score - points) / 10)) {
        // Crossed a multiple-of-10 milestone with this pickup.
        const milestone = Math.floor(score / 10) * 10;
        const hold = speakWithHold(`brawo, ${milestone} punktów!`, 400);
        newTarget({ delayMs: hold });
      } else {
        // Short "brawo" + small gap before the new target speaks.
        const hold = speakWithHold('brawo', 300);
        newTarget({ delayMs: hold });
      }
    } else {
      // Score never goes below zero. Wrong pick resets combo.
      if (score > 0) score -= 1;
      combo = 0;
      mistakes++;
      spawnBad(c.x, c.y);
      spawnPop(c.x, c.y, '#e23b3b');
      playSfx('pickup', { volumeMul: 0.6 });
      respawnCollectible(c, maze, items, occupied, safe, player);
      ensureTargetOnBoard();
      updateHud();
      // Say "pomyłka" then re-speak target after the audio fully finishes.
      const hold = speakWithHold('pomyłka', 400);
      setTimeout(() => { if (running) speakOnce(target); }, hold);
    }
  }

  render();
  requestAnimationFrame(loop);
}

function render() {
  // Camera: follow player, clamp to maze.
  const viewW = canvas.width, viewH = canvas.height;
  let camX = Math.round(player.x - viewW / 2);
  let camY = Math.round(player.y - viewH / 2);
  camX = Math.max(0, Math.min(camX, maze.w - viewW));
  camY = Math.max(0, Math.min(camY, maze.h - viewH));
  // If maze smaller than view, center it.
  if (maze.w < viewW) camX = Math.round((maze.w - viewW) / 2);
  if (maze.h < viewH) camY = Math.round((maze.h - viewH) / 2);

  ctx.fillStyle = '#6cbff0';
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.save();
  // Snap camera to integer pixels so 16x16 sprites in tightly packed sheets
  // don't bleed into neighboring cells when the camera scrolls at sub-pixel
  // offsets (which made the player appear to rotate through directions).
  ctx.translate(-Math.round(camX), -Math.round(camY));
  drawMaze(ctx, maze, /* dt for animated tiles like the pond */ 1 / 60);
  // House is drawn on top of the wall sprites so it covers them; its own
  // cells were marked as walls in placeHouse(), so player can't walk through.
  drawHouse(ctx, house);
  drawCollectibles(ctx, collectibles, timeAcc);
  if (options.easy) drawEasyHints(ctx, collectibles, target, player, timeAcc);
  drawDiamond(ctx, diamond);
  drawFreeze(ctx, freeze);
  drawEnemies(ctx, enemies, {
    powered: poweredLeft > 0,
    poweredEndSoon: poweredLeft > 0 && poweredLeft <= POWER_BLINK_AT_S,
    frozen: frozenLeft > 0,
  });
  // Aura behind the ninja during power-ups (orange when enemies are
  // edible, cyan when they are frozen). Frozen wins if both are active
  // simultaneously — it's the rarer state.
  let aura = null;
  if (frozenLeft > 0) aura = '#9be8ff';
  else if (poweredLeft > 0) aura = '#ffb84d';
  drawPlayer(ctx, player, { aura });
  drawEffects(ctx);
  ctx.restore();

  // HUD: power-up countdown rings live in the DOM (#power-rings, left of score).
  updatePowerRing('power',  poweredLeft, POWER_DURATION_S,  POWER_BLINK_AT_S,
    '#9cff9c', '#ffeb3b');
  updatePowerRing('freeze', frozenLeft,  FREEZE_DURATION_S, FREEZE_BLINK_AT_S,
    '#9be8ff', '#bcdfff');
}

const RING_CIRC = 2 * Math.PI * 18; // r=18 in viewBox 48x48
function updatePowerRing(name, left, total, blinkAt, color, blinkColor) {
  const el = document.querySelector(`.power-ring[data-ring="${name}"]`);
  if (!el) return;
  if (left <= 0) { el.classList.add('off'); return; }
  el.classList.remove('off');
  const frac = Math.max(0, Math.min(1, left / total));
  const dash = frac * RING_CIRC;
  el.style.setProperty('--ring-dash', `${dash} ${RING_CIRC}`);
  const blinking = left <= blinkAt;
  el.style.setProperty('--ring-color', blinking ? blinkColor : color);
  el.classList.toggle('blink', blinking);
}

// Easy-mode visual aids (drawn in world space, after collectibles, before
// power-ups so they sit behind diamonds/scrolls):
//   1) a soft pulsing yellow halo around every correct-syllable disk so the
//      kid sees the goal at a glance,
//   2) after a few seconds without movement, a pulsing arrow above the
//      ninja that points toward the nearest correct disk.
function drawEasyHints(ctx, collectibles, target, player, t) {
  if (!collectibles || !target) return;
  const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 4));
  // (1) Halos.
  let nearest = null, nearestD2 = Infinity;
  for (const c of collectibles) {
    if (!sameSound(c.text, target)) continue;
    ctx.save();
    ctx.globalAlpha = 0.55 * pulse;
    ctx.fillStyle = '#fff27a';
    ctx.beginPath(); ctx.arc(c.x, c.y, 38, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffb000';
    ctx.beginPath(); ctx.arc(c.x, c.y, 32, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    const dx = c.x - player.x, dy = c.y - player.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < nearestD2) { nearestD2 = d2; nearest = c; }
  }
  // (2) Idle arrow over the player, pointing at the nearest correct disk.
  if (!nearest) return;
  const idleMs = performance.now() - lastMoveAt;
  if (idleMs < EASY_ARROW_IDLE_MS) return;
  // Don't bother if the kid is basically standing on it.
  if (nearestD2 < 60 * 60) return;
  const ang = Math.atan2(nearest.y - player.y, nearest.x - player.x);
  const cx = player.x, cy = player.y - 38;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.globalAlpha = 0.9 * pulse;
  ctx.fillStyle = '#ff8a00';
  ctx.strokeStyle = '#3a1a00';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(20, 0);
  ctx.lineTo(2, -10);
  ctx.lineTo(2, -4);
  ctx.lineTo(-14, -4);
  ctx.lineTo(-14, 4);
  ctx.lineTo(2, 4);
  ctx.lineTo(2, 10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
