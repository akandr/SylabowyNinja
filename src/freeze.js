// Freeze power-up — a second collectible item, rarer than the coin.
// When the player picks it up, the game enters a "frozen" state for a few
// seconds (handled in game.js): all enemies stop moving and render with a
// blue tint. Touching a frozen enemy does NOT penalize the player — they
// just bump off it harmlessly so the kid can run past clusters safely.

import { TILE, isWall } from './maze.js?v=78';
import { sheets } from './sprites.js?v=78';

const SPAWN_MIN_S = 25;     // rarer than the coin
const SPAWN_MAX_S = 45;
const MIN_DIST = 8;         // tiles away from player when spawning
const PICKUP_RADIUS = 22;   // px

const ICON_SCALE = 3;       // 16px source → 48px on screen

export function createFreezeState() {
  return {
    active: null,
    cooldownLeft: 18,         // delay before the first freeze can appear
  };
}

function rollNextDelay() {
  return SPAWN_MIN_S + Math.random() * (SPAWN_MAX_S - SPAWN_MIN_S);
}

export function updateFreeze(state, dt, maze, player, occupied) {
  if (state.active) {
    state.active.t += dt;
    return;
  }
  state.cooldownLeft -= dt;
  if (state.cooldownLeft > 0) return;

  const ptx = Math.floor(player.x / TILE);
  const pty = Math.floor(player.y / TILE);
  const candidates = maze.freeCells.filter(c => {
    if (occupied.has(`${c.x},${c.y}`)) return false;
    if (isWall(maze, c.x, c.y)) return false;
    const dx = c.x - ptx, dy = c.y - pty;
    return Math.hypot(dx, dy) >= MIN_DIST;
  });
  if (candidates.length === 0) {
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

export function checkFreezePickup(state, player) {
  if (!state.active) return false;
  const dx = state.active.x - player.x, dy = state.active.y - player.y;
  return dx * dx + dy * dy <= PICKUP_RADIUS * PICKUP_RADIUS;
}

export function consumeFreeze(state) {
  state.active = null;
  state.cooldownLeft = rollNextDelay();
}

export function drawFreeze(ctx, state) {
  if (!state.active) return;
  const f = state.active;
  const bob = Math.sin(f.t * 4) * 3;
  const halo = (Math.sin(f.t * 4) + 1) * 0.5;
  ctx.save();
  ctx.globalAlpha = 0.25 + halo * 0.4;
  ctx.fillStyle = '#9be8ff';   // cool blue halo for the ice scroll
  ctx.beginPath();
  ctx.arc(f.x, f.y + bob, 22 + halo * 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const sheet = sheets.freeze;
  if (!sheet.loaded) return;
  const dw = 16 * ICON_SCALE, dh = 16 * ICON_SCALE;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sheet.img,
    0, 0, 16, 16,
    Math.round(f.x - dw / 2), Math.round(f.y + bob - dh / 2), dw, dh,
  );
}
