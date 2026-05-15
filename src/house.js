// The player's spawn house: drawn as a single 4x4-tile sprite carved out of
// TilesetHouse.png, with its three top tile rows marked as walls so the
// player can stand at the door but not walk through the building.

import { TILE } from './maze.js?v=79';
import { sheets, drawRect, SRC } from './sprites.js?v=79';

// Top-left orange-roof house in the source tileset (cols 0..3, rows 0..2).
// The 4th row of the tileset contains unrelated door/window tiles, not part
// of this building, so we deliberately stop at 3 rows.
const HOUSE_SRC = { sx: 0, sy: 0, sw: 4 * SRC, sh: 3 * SRC };

// Footprint in tile coords (4 wide, 3 tall). Only the door cell on the
// bottom row is walkable; everything else is a wall.
const W = 4, H = 3;
const SOLID_ROWS = 2; // first N rows from the top are fully wall cells
const DOOR_DX = 1;    // column offset of the door on the bottom row

export function placeHouse(maze, tx, ty) {
  // Mark wall cells so collision and tile-rendering treat the house as solid.
  for (let dy = 0; dy < SOLID_ROWS; dy++) {
    for (let dx = 0; dx < W; dx++) {
      const x = tx + dx, y = ty + dy;
      if (y >= 0 && y < maze.rows && x >= 0 && x < maze.cols) {
        maze.grid[y][x] = 1;
      }
    }
  }
  // Bottom row: every cell is a wall except the door.
  {
    const y = ty + H - 1;
    for (let dx = 0; dx < W; dx++) {
      if (dx === DOOR_DX) continue;
      const x = tx + dx;
      if (y >= 0 && y < maze.rows && x >= 0 && x < maze.cols) {
        maze.grid[y][x] = 1;
      }
    }
  }
  // Recompute freeCells so the house cells aren't picked for collectibles.
  maze.freeCells = [];
  for (let y = 0; y < maze.rows; y++) {
    for (let x = 0; x < maze.cols; x++) {
      if (maze.grid[y][x] !== 1) maze.freeCells.push({ x, y });
    }
  }
  // Spawn point: the door cell (bottom row, second column from the left).
  const spawn = { x: tx + 1, y: ty + H - 1 };
  return {
    tx, ty, w: W, h: H,
    spawn,
    // Pixel coords for rendering.
    px: tx * TILE, py: ty * TILE,
  };
}

export function drawHouse(ctx, house) {
  // Skip the default wall sprites for the house cells: maze.js draws walls
  // from NATURE_WALL_TILES on cells with grid===1, which would put bushes
  // on top of the house. We can't easily disable that per-cell from here,
  // so we draw the house AFTER the walls — covering them up.
  drawRect(ctx, sheets.house, HOUSE_SRC.sx, HOUSE_SRC.sy, HOUSE_SRC.sw, HOUSE_SRC.sh,
           house.px, house.py, 3 /* TILE_SCALE */, false);
}
