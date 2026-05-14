// Diamond power-up. At most one diamond exists on the map at a time.
// When the player picks it up, the game enters a "powered" state for a few
// seconds (handled in game.js): enemies turn green and become edible.
//
// Spawn rules:
//   - Random delay between SPAWN_MIN_S and SPAWN_MAX_S after the previous
//     diamond was picked up (or after game start).
//   - Picks a free cell that is at least MIN_DIST tiles from the player,
//     not on a syllable tile, and not in the house safe zone.

import { TILE, isWall } from './maze.js?v=78';
import { sheets } from './sprites.js?v=78';

const SPAWN_MIN_S = 12;     // earliest seconds until a new diamond appears
const SPAWN_MAX_S = 25;     // latest seconds until a new diamond appears
const MIN_DIST = 8;         // tiles away from player when spawning
const PICKUP_RADIUS = 22;   // px

// Coin sprite-sheet layout: Coin2.png = 40x10, 4 frames horizontally at 10x10.
const COIN_FRAME = 10;
const COIN_FRAMES = 4;
const COIN_FPS = 8;
const COIN_SCALE = 4;       // 10px source → 40px on screen

export function createDiamondState() {
  return {
    active: null,            // { tx, ty, x, y, t } when present, null otherwise
    cooldownLeft: 6,         // seconds until next spawn attempt (initial small delay)
  };
}

function rollNextDelay() {
  return SPAWN_MIN_S + Math.random() * (SPAWN_MAX_S - SPAWN_MIN_S);
}

// Decrement cooldown; if expired, try to spawn a diamond on a valid cell.
// `occupied` should be a Set of "tx,ty" keys that are taken (syllable tiles,
// safe zone, etc.) so we don't overlap.
export function updateDiamond(state, dt, maze, player, occupied) {
  if (state.active) {
    state.active.t += dt;
    return;
  }
  state.cooldownLeft -= dt;
  if (state.cooldownLeft > 0) return;

  // Pick a random free cell that is far enough from the player.
  const ptx = Math.floor(player.x / TILE);
  const pty = Math.floor(player.y / TILE);
  const candidates = maze.freeCells.filter(c => {
    if (occupied.has(`${c.x},${c.y}`)) return false;
    if (isWall(maze, c.x, c.y)) return false;
    const dx = c.x - ptx, dy = c.y - pty;
    return Math.hypot(dx, dy) >= MIN_DIST;
  });
  if (candidates.length === 0) {
    // No room right now — try again soon.
    state.cooldownLeft = 2;
    return;
  }
  const cell = candidates[Math.floor(Math.random() * candidates.length)];
  state.active = {
    tx: cell.x, ty: cell.y,
    x: cell.x * TILE + TILE / 2,
    y: cell.y * TILE + TILE / 2,
    t: 0,
  };
}

// Returns true if the player is touching the diamond. Caller is responsible
// for removing it (via consumeDiamond) and starting the powered state.
export function checkDiamondPickup(state, player) {
  if (!state.active) return false;
  const dx = state.active.x - player.x, dy = state.active.y - player.y;
  return dx * dx + dy * dy <= PICKUP_RADIUS * PICKUP_RADIUS;
}

export function consumeDiamond(state) {
  state.active = null;
  state.cooldownLeft = rollNextDelay();
}

export function drawDiamond(ctx, state) {
  if (!state.active) return;
  const d = state.active;
  // Floating bob.
  const bob = Math.sin(d.t * 4) * 3;
  // Soft warm halo behind the spinning coin so it pops against the grass.
  const halo = (Math.sin(d.t * 4) + 1) * 0.5; // 0..1
  ctx.save();
  ctx.globalAlpha = 0.25 + halo * 0.35;
  ctx.fillStyle = '#ffd76a';
  ctx.beginPath();
  ctx.arc(d.x, d.y + bob, 22 + halo * 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Spinning coin: cycle through 4 frames of Coin2.png.
  const sheet = sheets.coin;
  if (!sheet.loaded) return;
  const frame = Math.floor(d.t * COIN_FPS) % COIN_FRAMES;
  const dw = COIN_FRAME * COIN_SCALE, dh = COIN_FRAME * COIN_SCALE;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sheet.img,
    frame * COIN_FRAME, 0, COIN_FRAME, COIN_FRAME,
    Math.round(d.x - dw / 2), Math.round(d.y + bob - dh / 2), dw, dh,
  );
}
