// Roaming red-squid enemies. They animate continuously (independent of motion)
// and wander in random directions, bouncing off walls. Touching one penalizes
// the player (handled in game.js).
//
// When the player picks up a diamond, the game enters a "powered" state for
// a few seconds — during that window, enemies render with the green sprite
// sheet and a player touch *eats* them instead of penalizing. Eaten enemies
// disappear for RESPAWN_DELAY_S and reappear far from the player.

import { TILE, isWall } from './maze.js?v=78';
import { sheets, drawRect } from './sprites.js?v=78';

// SquidRed Walk.png is 304x79 = 4 frames horizontally at 76x79 each.
const FRAME_W = 76, FRAME_H = 79;
const FRAMES = 4;
const ANIM_FPS = 6;

const SPEED = 70;        // px/sec — slower than the player so it's escapable
const RADIUS = 30;       // collision radius for hitting the player (forgiving)
const TURN_MIN = 1.2;    // sec — minimum time before picking a new direction
const TURN_MAX = 3.0;    // sec — maximum time before picking a new direction
const SCALE = 1.5;       // squid is already a "boss" sprite; don't draw too big
const RESPAWN_DELAY_S = 6; // how long an eaten squid stays gone before reappearing
const RESPAWN_MIN_DIST = 8; // tiles from player when an eaten squid reappears

export function spawnEnemies(maze, count, awayFrom, exclude = new Set()) {
  const enemies = [];
  // Pick free cells that are at least N tiles away from the spawn point AND
  // outside any explicitly excluded cells (the house safe zone).
  const minDist = 8;
  const candidates = maze.freeCells.filter(c => {
    if (exclude.has(`${c.x},${c.y}`)) return false;
    const dx = c.x - awayFrom.x, dy = c.y - awayFrom.y;
    return Math.hypot(dx, dy) >= minDist;
  });
  shuffle(candidates);
  for (let i = 0; i < count && i < candidates.length; i++) {
    const cell = candidates[i];
    enemies.push(makeEnemy(cell.x * TILE + TILE / 2, cell.y * TILE + TILE / 2));
  }
  return enemies;
}

function makeEnemy(x, y) {
  return {
    x, y,
    vx: 0, vy: 0,
    animTime: Math.random() * 1.0, // desync so they don't blink together
    turnTimer: 0,
    cooldown: 0,        // brief pause after hitting the player
    eaten: false,       // true while waiting to respawn after being eaten
    respawnTimer: 0,    // seconds until this eaten squid reappears
  };
}

function pickDirection(e) {
  const a = Math.random() * Math.PI * 2;
  e.vx = Math.cos(a) * SPEED;
  e.vy = Math.sin(a) * SPEED;
  e.turnTimer = TURN_MIN + Math.random() * (TURN_MAX - TURN_MIN);
}

export function updateEnemies(enemies, dt, maze, player, opts = {}) {
  const { frozen = false, speedMul = 1, noGo = null } = opts;
  for (const e of enemies) {
    if (e.eaten) {
      e.respawnTimer -= dt;
      if (e.respawnTimer <= 0) respawnEnemy(e, maze, player, noGo);
      continue;
    }
    e.animTime += dt;
    if (frozen) continue;        // ice scroll: enemies stand still entirely
    if (e.cooldown > 0) { e.cooldown -= dt; continue; }
    e.turnTimer -= dt;
    if (e.turnTimer <= 0 || (e.vx === 0 && e.vy === 0)) pickDirection(e);

    // Try to move on each axis; reverse on that axis if blocked.
    const r = 14;
    const nx = e.x + e.vx * speedMul * dt;
    if (collidesAt(nx, e.y, r, maze, noGo)) { e.vx = -e.vx; }
    else { e.x = nx; }
    const ny = e.y + e.vy * speedMul * dt;
    if (collidesAt(e.x, ny, r, maze, noGo)) { e.vy = -e.vy; }
    else { e.y = ny; }
  }
}

// Move an eaten squid back onto the map at a random free cell that is at
// least RESPAWN_MIN_DIST tiles away from the player; reset its state so it
// behaves like a fresh enemy.
function respawnEnemy(e, maze, player, noGo = null) {
  const ptx = Math.floor(player.x / TILE);
  const pty = Math.floor(player.y / TILE);
  const candidates = maze.freeCells.filter(c => {
    if (noGo && noGo.has(`${c.x},${c.y}`)) return false;
    const dx = c.x - ptx, dy = c.y - pty;
    return Math.hypot(dx, dy) >= RESPAWN_MIN_DIST;
  });
  if (candidates.length === 0) {
    // Try again next frame.
    e.respawnTimer = 0.5;
    return;
  }
  const cell = candidates[Math.floor(Math.random() * candidates.length)];
  e.x = cell.x * TILE + TILE / 2;
  e.y = cell.y * TILE + TILE / 2;
  e.vx = 0; e.vy = 0;
  e.eaten = false;
  e.cooldown = 0;
  e.turnTimer = 0;
}

function collidesAt(cx, cy, r, maze, noGo = null) {
  const pts = [[cx - r, cy - r], [cx + r, cy - r], [cx - r, cy + r], [cx + r, cy + r]];
  for (const [x, y] of pts) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (isWall(maze, tx, ty)) return true;
    if (noGo && noGo.has(`${tx},${ty}`)) return true;
  }
  return false;
}

export function drawEnemies(ctx, enemies, opts = {}) {
  const { powered = false, poweredEndSoon = false, frozen = false } = opts;
  for (const e of enemies) {
    if (e.eaten) continue;
    const frame = Math.floor(e.animTime * ANIM_FPS) % FRAMES;
    // While "powered", swap to the green sprite. If the powered window is
    // about to expire, blink between green and red so the player knows time
    // is running out.
    let sheet = sheets.squid;
    if (powered) {
      const blink = poweredEndSoon
        ? Math.floor(e.animTime * 6) % 2 === 0
        : true;
      sheet = blink ? sheets.squidGreen : sheets.squid;
    }
    drawRect(ctx, sheet,
      frame * FRAME_W, 0, FRAME_W, FRAME_H,
      e.x, e.y, SCALE, true /* centered */);
    // Frozen state: layer a translucent cyan tint over the sprite to make
    // it read as "iced".
    if (frozen) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#9be8ff';
      ctx.beginPath();
      ctx.arc(e.x, e.y, FRAME_W * SCALE * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

// Returns the index of an enemy currently overlapping the player, or -1.
// Eaten enemies are ignored.
export function checkEnemyHit(player, enemies) {
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.cooldown > 0 || e.eaten) continue;
    const dx = e.x - player.x, dy = e.y - player.y;
    if (dx * dx + dy * dy <= RADIUS * RADIUS) return i;
  }
  return -1;
}

// Mark an enemy as eaten; it will respawn far away after RESPAWN_DELAY_S.
export function eatEnemy(e) {
  e.eaten = true;
  e.respawnTimer = RESPAWN_DELAY_S;
  e.vx = 0; e.vy = 0;
}

// Push the enemy a few tiles away from the player after a hit, and put it on
// cooldown briefly so a single touch doesn't trigger a chain of penalties.
export function knockbackEnemy(e, player, maze) {
  e.cooldown = 1.0;
  let dx = e.x - player.x, dy = e.y - player.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  // Try increasing knockback distances; settle on the largest non-colliding spot.
  for (const dist of [TILE * 4, TILE * 3, TILE * 2, TILE]) {
    const nx = e.x + dx * dist, ny = e.y + dy * dist;
    if (!collidesAt(nx, ny, 14, maze)) { e.x = nx; e.y = ny; return; }
  }
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}
