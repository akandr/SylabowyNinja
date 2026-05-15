// Top-down ninja player with grid-based movement (Pac-Man style):
// the player snaps to tile centers and slides smoothly between adjacent
// tiles. Held inputs are buffered so a turn pressed mid-move takes effect
// at the next intersection — much easier to control with touch/D-pad.

import { TILE, isWall } from './maze.js?v=79';
import { sheets, DIR_COL, drawSprite } from './sprites.js?v=79';

const SPEED = 220;     // px/sec along the moving axis (slightly faster — no diag)
const SCALE = 3;       // 16px source -> 48px on screen
const FRAMES_PER_DIR = 4;
const ANIM_FPS = 10;

// Order matters when multiple keys are held simultaneously; we prefer the
// most recently expressed direction by snapshotting input transitions.
const DIRS = {
  up:    { dx:  0, dy: -1 },
  down:  { dx:  0, dy:  1 },
  left:  { dx: -1, dy:  0 },
  right: { dx:  1, dy:  0 },
};

export function createPlayer(spawn) {
  return {
    // Logical tile (always integer when not moving).
    tx: spawn.x, ty: spawn.y,
    // Visual position in pixels (interpolates between tile centers).
    x: spawn.x * TILE + TILE / 2,
    y: spawn.y * TILE + TILE / 2,
    // Movement state.
    facing: 'down',
    moving: false,
    moveDir: null,        // 'up'|'down'|'left'|'right' while sliding
    nextDir: null,        // buffered turn (taken at next tile center)
    targetTx: spawn.x,    // tile we're sliding toward
    targetTy: spawn.y,
    animTime: 0,
  };
}

// Pick a desired direction from current input, preferring whichever key was
// most recently pressed. We track the last-pressed via the input object.
function pickDir(input) {
  const dir = input;
  // Prefer the most recently pressed direction (input.lastPressed) if held.
  if (dir.lastPressed && dir[dir.lastPressed]) return dir.lastPressed;
  if (dir.up)    return 'up';
  if (dir.down)  return 'down';
  if (dir.left)  return 'left';
  if (dir.right) return 'right';
  return null;
}

function canEnter(maze, tx, ty) {
  return !isWall(maze, tx, ty);
}

export function updatePlayer(p, dt, dir, maze) {
  const desired = pickDir(dir);

  if (!p.moving) {
    // At a tile center: pick a direction immediately if the held key allows it.
    if (desired) {
      const d = DIRS[desired];
      if (canEnter(maze, p.tx + d.dx, p.ty + d.dy)) {
        p.moveDir = desired;
        p.facing = desired;
        p.targetTx = p.tx + d.dx;
        p.targetTy = p.ty + d.dy;
        p.moving = true;
      }
    }
  } else {
    // While sliding, allow the user to express a turn for the NEXT tile.
    if (desired && desired !== p.moveDir) p.nextDir = desired;
  }

  if (!p.moving) { p.animTime = 0; return; }

  // Slide toward target tile center.
  const tx = p.targetTx * TILE + TILE / 2;
  const ty = p.targetTy * TILE + TILE / 2;
  const dxRem = tx - p.x, dyRem = ty - p.y;
  const dist = Math.hypot(dxRem, dyRem);
  const step = SPEED * dt;
  if (step >= dist) {
    // Arrived at target tile.
    p.x = tx; p.y = ty;
    p.tx = p.targetTx; p.ty = p.targetTy;

    // Decide next move: buffered turn first (if valid), else continue if held, else stop.
    const tryDir = (name) => {
      if (!name) return false;
      const d = DIRS[name];
      if (!canEnter(maze, p.tx + d.dx, p.ty + d.dy)) return false;
      p.moveDir = name; p.facing = name;
      p.targetTx = p.tx + d.dx; p.targetTy = p.ty + d.dy;
      p.moving = true;
      return true;
    };

    const buffered = p.nextDir;
    p.nextDir = null;
    p.moving = false;
    // Only continue if a direction is actively held: buffered turn first, else
    // the currently-held direction. If nothing is held, stop on this tile.
    if (!tryDir(buffered) && !tryDir(desired)) {
      p.moveDir = null;
    }
  } else {
    p.x += (dxRem / dist) * step;
    p.y += (dyRem / dist) * step;
  }

  p.animTime += dt;
}

export function drawPlayer(ctx, p, opts = {}) {
  const { aura = null } = opts;
  // Optional aura ring drawn UNDER the sprite — used during power-up states
  // (orange = powered, blue = frozen-enemies). The aura pulses with time
  // so it reads as "active" without distracting from the ninja sprite.
  if (aura) {
    const t = (performance.now() / 1000);
    const pulse = 0.75 + 0.25 * Math.sin(t * 6);
    ctx.save();
    ctx.globalAlpha = 0.45 * pulse;
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(p.x, p.y + 4, 30 + 4 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Sheet layout: column = facing, row = walk-cycle frame.
  const col = DIR_COL[p.facing];
  const sheet = p.moving ? sheets.walk : sheets.idle;
  const row = p.moving ? Math.floor(p.animTime * ANIM_FPS) % FRAMES_PER_DIR : 0;
  // Slight upward draw offset so feet sit near the bottom of the tile.
  drawSprite(ctx, sheet, col, row, p.x, p.y - 4, SCALE, false);
}

export function playerTile(p) {
  return { tx: p.tx, ty: p.ty };
}
