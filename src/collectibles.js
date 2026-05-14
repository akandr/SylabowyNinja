// Syllable tiles scattered on free cells. One pickup at a time on collision.

import { TILE } from './maze.js?v=78';
import { pickRandom } from './syllables.js?v=78';

// Pickup hitbox is a bit larger than the visible disk so brushing past one
// counts. Disk radius is 26 — wide enough to fit 4-letter syllables.
const PICK_RADIUS = 34;
const DISK_RADIUS = 26;
// Minimum spacing between any two syllable disks at spawn time, in tiles.
// Keeps neighbours far enough apart that you can't brush against the wrong
// one when reaching for the right one.
const MIN_SPACING_TILES = 3;
// On respawn, keep the new disk at least this many tiles away from the
// player so they can't accidentally pick it up immediately after collecting
// the previous one (which sits at the player's current position).
const MIN_PLAYER_DISTANCE_TILES = 5;

export function spawnCollectibles(maze, items, count, exclude = new Set()) {
  // Pick distinct free cells, skipping any cells passed in `exclude`
  // (typically the player spawn and the area around the house) and keeping
  // a minimum spacing between picked cells.
  const free = maze.freeCells.filter(c => !exclude.has(`${c.x},${c.y}`));
  shuffle(free);
  const picked = [];
  const minSq = MIN_SPACING_TILES * MIN_SPACING_TILES;
  for (const c of free) {
    if (picked.length >= count) break;
    let ok = true;
    for (const p of picked) {
      const dx = c.x - p.x, dy = c.y - p.y;
      if (dx * dx + dy * dy < minSq) { ok = false; break; }
    }
    if (ok) picked.push(c);
  }
  // If the spacing constraint left us short, fall back to any remaining
  // free cells (still skipping exclusions) so we always meet `count`.
  if (picked.length < count) {
    const taken = new Set(picked.map(p => `${p.x},${p.y}`));
    for (const c of free) {
      if (picked.length >= count) break;
      if (taken.has(`${c.x},${c.y}`)) continue;
      picked.push(c);
    }
  }
  return picked.map(c => ({
    tx: c.x, ty: c.y,
    x: c.x * TILE + TILE / 2,
    y: c.y * TILE + TILE / 2,
    text: pickRandom(items),
    bobPhase: Math.random() * Math.PI * 2,
  }));
}

export function respawnCollectible(c, maze, items, occupied, exclude = new Set(), player = null) {
  // Prefer cells that are also far from every other live collectible.
  const others = [];
  for (const key of occupied) {
    const [sx, sy] = key.split(',').map(Number);
    if (sx === c.tx && sy === c.ty) continue; // skip self
    others.push({ x: sx, y: sy });
  }
  const minSq = MIN_SPACING_TILES * MIN_SPACING_TILES;
  const playerMinSq = MIN_PLAYER_DISTANCE_TILES * MIN_PLAYER_DISTANCE_TILES;
  // Player tile (if provided) — used to forbid near-instant re-pickup.
  const ptx = player ? Math.floor(player.x / TILE) : null;
  const pty = player ? Math.floor(player.y / TILE) : null;
  const free = maze.freeCells.filter(cell =>
    !occupied.has(`${cell.x},${cell.y}`) && !exclude.has(`${cell.x},${cell.y}`)
  );
  if (free.length === 0) return;
  // 1st preference: far from other tiles AND far from the player.
  // 2nd preference: just far from the player (drop spacing constraint).
  // 3rd preference: any free cell.
  const farFromPlayer = (cell) => {
    if (ptx === null) return true;
    const dx = cell.x - ptx, dy = cell.y - pty;
    return dx * dx + dy * dy >= playerMinSq;
  };
  const farFromOthers = (cell) =>
    others.every(o => {
      const dx = cell.x - o.x, dy = cell.y - o.y;
      return dx * dx + dy * dy >= minSq;
    });
  let pool = free.filter(cell => farFromOthers(cell) && farFromPlayer(cell));
  if (pool.length === 0) pool = free.filter(farFromPlayer);
  if (pool.length === 0) pool = free.filter(farFromOthers);
  if (pool.length === 0) pool = free;
  const cell = pool[Math.floor(Math.random() * pool.length)];
  c.tx = cell.x; c.ty = cell.y;
  c.x = cell.x * TILE + TILE / 2;
  c.y = cell.y * TILE + TILE / 2;
  c.text = pickRandom(items, c.text);
  c.bobPhase = Math.random() * Math.PI * 2;
}

export function checkPickup(player, collectibles) {
  for (let i = 0; i < collectibles.length; i++) {
    const c = collectibles[i];
    const dx = c.x - player.x, dy = c.y - player.y;
    if (dx * dx + dy * dy <= PICK_RADIUS * PICK_RADIUS) return i;
  }
  return -1;
}

export function drawCollectibles(ctx, collectibles, t) {
  for (const c of collectibles) {
    const bob = Math.sin(t * 3 + c.bobPhase) * 3;
    const cx = c.x, cy = c.y + bob;
    // Solid yellow disk — no outline, large enough for 4-letter syllables.
    ctx.fillStyle = '#ffd84d';
    ctx.beginPath(); ctx.arc(cx, cy, DISK_RADIUS, 0, Math.PI * 2); ctx.fill();
    // Text: scale down for longer syllables so they always fit comfortably.
    // Uppercase — easier to read for early readers (PA, PO, PEPI...).
    const label = c.text.toUpperCase();
    const fontSize = label.length >= 4 ? 18 : label.length === 3 ? 22 : 26;
    ctx.fillStyle = '#1a1a1a';
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy + 1);
  }
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}
