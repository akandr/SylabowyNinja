// Tile-based maze rendered with the Ninja Adventure tilesets.
// 0 = floor (walkable), 1 = wall (blocking), 2 = decorative grass (walkable).

import { sheets, drawTile, SRC } from './sprites.js?v=78';

const TILE_SCALE = 3;
export const TILE = SRC * TILE_SCALE; // 48

// Wall sprites in TilesetNature.png often render visually smaller than the
// 48-px tile they occupy (small bushes, snowballs). With a full-tile hitbox
// the player feels "hit an invisible wall" when brushing past such a tile's
// grass-looking margin. We inset the wall hitbox by a few pixels so
// collision matches the visible obstacle better. drawMaze() also paints a
// matching dark footprint so every wall is unambiguous to the eye.
export const WALL_INSET = 6;

// Tile picks inside the source sheets (col, row in 16x16 units).
// Coordinates verified from labeled grids of TilesetFloor.png / TilesetNature.png.

// Plain grass — uniform tiles from the green-grass strip in TilesetFloor.png.
// Mostly identical so the field looks coherent; a few stroked variants add
// subtle texture without breaking the pattern.
const FLOOR_GRASS_TILES = [
  { col: 12, row: 12 }, // plain grass
  { col: 13, row: 12 }, // plain grass
  { col: 14, row: 12 }, // plain grass
  { col: 12, row: 12 },
  { col: 13, row: 12 },
  { col: 14, row: 12 },
  { col: 11, row: 12 }, // grass with small strokes
  { col: 15, row: 12 }, // grass with tiny marks
];
// Walkable accents (drawn over grass on cells marked '2').
const FLOOR_DECOR_TILES = [
  // (intentionally empty — the carrot was removed)
];
// 1-tile walls grouped by THEME so each connected obstacle cluster looks
// coherent (a stump grove is all wood, a rock pile is all rocks, etc.).
// All tiles are from TilesetNature.png.
const WALL_THEMES = {
  // Orange tree stumps + a fiery bush — warm "wood" palette.
  stumps: [
    { col: 12, row: 13 }, { col: 13, row: 13 },
    { col: 4,  row: 8  }, { col: 4,  row: 9 },
  ],
  // Grey + tan boulders.
  rocks: [
    { col: 17, row: 17 }, { col: 18, row: 17 },
    { col: 17, row: 13 }, { col: 18, row: 13 },
  ],
  // Cool palette — blue stone + snowball.
  ice: [
    { col: 19, row: 13 }, { col: 8, row: 12 },
  ],
  // Leafy green bushes.
  bushes: [
    { col: 5, row: 12 }, { col: 8, row: 11 },
    { col: 9, row: 11 }, { col: 3, row: 10 },
  ],
};
// Border (outer ring) — picked per orientation in drawMaze.
const BORDER_TILE_HORIZONTAL = { col: 9,  row: 9 };
const BORDER_TILE_VERTICAL   = { col: 11, row: 9 };
// Themes interior clusters can pick from. Listed multiple times to bias the
// distribution: bushes are most common, then rocks, then stumps, then ice.
const INTERIOR_THEMES = [
  'bushes', 'bushes', 'bushes',
  'rocks',  'rocks',
  'stumps', 'stumps',
  'ice',
];

// Decorative grass overlays — small flowers and pebbles drawn on a few
// percent of plain-floor cells. Pure cosmetic, no gameplay effect. Color
// + position is deterministic per (x,y) so it stays stable across redraws
// and respawns, never "flickers". Kinds: flower (3 colored dots) or pebble
// (single grey blob).
const DECOR_RATE = 0.05; // ~5% of floor cells get a small accent
const FLOWER_PALETTE = ['#ff6b8a', '#ffd24d', '#9be6ff', '#c79bff', '#ff9bd6'];

// 36 cols x 22 rows. Denser layout with clusters of trees / rocks forming
// little rooms and corridors, plus walkable accents scattered on the grass.
// Procedural maze generator. Produces an outer wall ring plus randomly
// placed interior wall clusters (1x1, 2x1, 1x2, 2x2, 3x1, 1x3 shapes), with
// a guaranteed 1-cell gap between clusters so corridors stay walkable.
// A 6x6 region at (1,1) is kept fully clear so the house can be stamped
// there afterwards (see house.js) and the player has a safe porch.
//
// Connectivity is verified by BFS from the house door cell; any unreachable
// pocket has its blocking walls knocked down.
function generateGrid(cols, rows, density = 0.18) {
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  // Outer wall ring.
  for (let x = 0; x < cols; x++) { grid[0][x] = 1; grid[rows - 1][x] = 1; }
  for (let y = 0; y < rows; y++) { grid[y][0] = 1; grid[y][cols - 1] = 1; }

  // Pre-cleared region for the house + porch (top-left corner).
  const HX0 = 1, HY0 = 1, HX1 = 7, HY1 = 7;
  const inHouseRegion = (x, y) => x >= HX0 && x <= HX1 && y >= HY0 && y <= HY1;

  const interiorCells = (cols - 2) * (rows - 2) - (HX1 - HX0 + 1) * (HY1 - HY0 + 1);
  const targetWalls = Math.floor(interiorCells * density);
  const SHAPES = [
    [[0,0]],                                // single
    [[0,0],[1,0]],                          // horiz pair
    [[0,0],[0,1]],                          // vert pair
    [[0,0],[1,0],[0,1],[1,1]],              // 2x2 block
    [[0,0],[1,0],[2,0]],                    // horiz triple
    [[0,0],[0,1],[0,2]],                    // vert triple
  ];
  const hasNeighborWall = (sx, sy, shape) => {
    for (const [dx, dy] of shape) {
      const x = sx + dx, y = sy + dy;
      for (let ny = y - 1; ny <= y + 1; ny++) {
        for (let nx = x - 1; nx <= x + 1; nx++) {
          if (nx <= 0 || ny <= 0 || nx >= cols - 1 || ny >= rows - 1) continue;
          if (shape.some(([sdx, sdy]) => sx + sdx === nx && sy + sdy === ny)) continue;
          if (grid[ny][nx] === 1) return true;
        }
      }
    }
    return false;
  };

  let placed = 0, attempts = 0;
  const maxAttempts = targetWalls * 30;
  while (placed < targetWalls && attempts < maxAttempts) {
    attempts++;
    const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    const sx = 1 + Math.floor(Math.random() * (cols - 2));
    const sy = 1 + Math.floor(Math.random() * (rows - 2));
    let ok = true;
    for (const [dx, dy] of shape) {
      const x = sx + dx, y = sy + dy;
      if (x <= 0 || y <= 0 || x >= cols - 1 || y >= rows - 1) { ok = false; break; }
      if (inHouseRegion(x, y)) { ok = false; break; }
      if (grid[y][x] !== 0) { ok = false; break; }
    }
    if (!ok) continue;
    // Require a 1-cell gap to other interior clusters so the maze stays
    // navigable (border walls are ignored in this check).
    if (hasNeighborWall(sx, sy, shape)) continue;
    for (const [dx, dy] of shape) { grid[sy + dy][sx + dx] = 1; placed++; }
  }

  // Decorative grass accents on a small fraction of floor cells.
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (grid[y][x] === 0 && !inHouseRegion(x, y) && Math.random() < 0.04) {
        grid[y][x] = 2;
      }
    }
  }

  // Connectivity: BFS from the door cell (3,5) over walkable cells (0 or 2).
  // Anything unreachable gets its blocking border knocked down.
  ensureConnected(grid, 3, 5);
  return grid;
}

function ensureConnected(grid, startX, startY) {
  const rows = grid.length, cols = grid[0].length;
  // Repeat until everything is reachable. Each pass: BFS, then for any
  // unreachable walkable cell, find the nearest reachable cell and clear
  // the walls along a Manhattan path between them.
  for (let pass = 0; pass < 6; pass++) {
    const seen = Array.from({ length: rows }, () => new Array(cols).fill(false));
    const stack = [[startX, startY]];
    seen[startY][startX] = true;
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (seen[ny][nx] || grid[ny][nx] === 1) continue;
        seen[ny][nx] = true;
        stack.push([nx, ny]);
      }
    }
    // Find an unreachable walkable cell.
    let stranded = null;
    outer: for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        if (grid[y][x] !== 1 && !seen[y][x]) { stranded = [x, y]; break outer; }
      }
    }
    if (!stranded) return; // done
    // Punch a corridor toward the start: walk in straight lines knocking
    // down walls until we're connected.
    let [x, y] = stranded;
    while (!seen[y][x]) {
      grid[y][x] = 0;
      if (x !== startX) x += startX < x ? -1 : 1;
      else if (y !== startY) y += startY < y ? -1 : 1;
      else break;
    }
  }
}

export function createMaze({ cols = 36, rows = 22, density = 0.18 } = {}) {
  const grid = generateGrid(cols, rows, density);
  const freeCells = [];
  // Pre-compute a stable random tile pick per cell so rendering is consistent.
  const tilePick = [];
  for (let y = 0; y < rows; y++) {
    const row = [];
    for (let x = 0; x < cols; x++) {
      if (grid[y][x] !== 1) freeCells.push({ x, y });
      // simple deterministic hash for tile variety
      const h = (x * 73856093) ^ (y * 19349663);
      row.push(Math.abs(h));
    }
    tilePick.push(row);
  }
  // Group walls into connected components (4-connected) and assign each one
  // a theme; the outer ring (anything that touches the maze edge) is always
  // the border theme, which makes the level perimeter read as a hedge fence.
  const wallTheme = []; // [y][x] -> theme name (or null for non-walls)
  for (let y = 0; y < rows; y++) wallTheme.push(new Array(cols).fill(null));
  const visited = new Array(rows).fill(0).map(() => new Array(cols).fill(false));
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (grid[y][x] !== 1 || visited[y][x]) continue;
      // BFS to collect this component.
      const stack = [[x, y]];
      const comp = [];
      let touchesBorder = false;
      visited[y][x] = true;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        comp.push([cx, cy]);
        if (cx === 0 || cy === 0 || cx === cols - 1 || cy === rows - 1) touchesBorder = true;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          if (grid[ny][nx] !== 1 || visited[ny][nx]) continue;
          visited[ny][nx] = true;
          stack.push([nx, ny]);
        }
      }
      // Theme selection: border component or any cell touching it gets a
      // null tile (rendered later as the dedicated border tiles); interior
      // clusters pick a single theme AND a single tile within that theme,
      // so every cell in the cluster looks identical (e.g. three identical
      // stumps in a row instead of a stump + boulder + bush mix).
      let tile;
      if (touchesBorder) {
        tile = null;
      } else {
        // Anchor = top-left cell of the component for stability.
        const ax = Math.min(...comp.map(([cx]) => cx));
        const ay = Math.min(...comp.map(([, cy]) => cy));
        const h = Math.abs((ax * 2654435761) ^ (ay * 40503));
        const theme = INTERIOR_THEMES[h % INTERIOR_THEMES.length];
        const variants = WALL_THEMES[theme];
        tile = variants[Math.floor(h / INTERIOR_THEMES.length) % variants.length];
      }
      for (const [cx, cy] of comp) wallTheme[cy][cx] = tile;
    }
  }
  // Pond: pick the largest interior wall cluster of size >= 4 and re-mark
  // every cell in it with the special { pond: true } sentinel. drawMaze
  // renders those cells as animated water instead of a nature sprite, so
  // we get a visible landmark without changing the maze layout or gameplay.
  pickPond(grid, wallTheme, rows, cols);
  return {
    grid, rows, cols, freeCells, tilePick, wallTheme,
    w: cols * TILE, h: rows * TILE,
    // Animated state — drawMaze advances this each frame.
    timeAcc: 0,
  };
}

function pickPond(grid, wallTheme, rows, cols) {
  // Re-walk the wall components (skip border) and pick the LARGEST interior
  // one. Ponds are a rare landmark — at most one per maze.
  const seen = Array.from({ length: rows }, () => new Array(cols).fill(false));
  let best = null;
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (grid[y][x] !== 1 || seen[y][x]) continue;
      const stack = [[x, y]];
      const comp = [];
      seen[y][x] = true;
      let touchesBorder = false;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        comp.push([cx, cy]);
        if (cx === 0 || cy === 0 || cx === cols - 1 || cy === rows - 1) touchesBorder = true;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          if (grid[ny][nx] !== 1 || seen[ny][nx]) continue;
          seen[ny][nx] = true;
          stack.push([nx, ny]);
        }
      }
      if (touchesBorder) continue;
      if (comp.length < 3) continue;
      if (!best || comp.length > best.length) best = comp;
    }
  }
  if (!best) return;
  for (const [cx, cy] of best) wallTheme[cy][cx] = { pond: true };
}

export function isWall(maze, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= maze.cols || ty >= maze.rows) return true;
  return maze.grid[ty][tx] === 1;
}

export function tileAtPx(px, py) {
  return { tx: Math.floor(px / TILE), ty: Math.floor(py / TILE) };
}

export function drawMaze(ctx, maze, dt = 0) {
  maze.timeAcc = (maze.timeAcc || 0) + dt;
  const t = maze.timeAcc;
  // Grass everywhere first (walls also have grass underneath, looks nicer).
  for (let y = 0; y < maze.rows; y++) {
    for (let x = 0; x < maze.cols; x++) {
      const px = x * TILE, py = y * TILE;
      const tile = FLOOR_GRASS_TILES[maze.tilePick[y][x] % FLOOR_GRASS_TILES.length];
      drawTile(ctx, sheets.floor, tile.col, tile.row, px, py, TILE_SCALE);
    }
  }
  // Walkable decorations on top of grass (cells marked '2').
  if (FLOOR_DECOR_TILES.length > 0) {
    for (let y = 0; y < maze.rows; y++) {
      for (let x = 0; x < maze.cols; x++) {
        if (maze.grid[y][x] !== 2) continue;
        const px = x * TILE, py = y * TILE;
        const tile = FLOOR_DECOR_TILES[maze.tilePick[y][x] % FLOOR_DECOR_TILES.length];
        drawTile(ctx, sheets.floor, tile.col, tile.row, px, py, TILE_SCALE);
      }
    }
  }
  // Walls on top — border ring uses dedicated horizontal/vertical tiles;
  // interior cells pick from their cluster's theme so each connected
  // obstacle group is one consistent material (all rocks, all bushes, etc.).
  // For every interior wall we ALSO draw a subtle dark footprint matching
  // the player's effective hitbox, so visually-thin sprites (small bushes,
  // snowballs) read clearly as obstacles instead of "invisible walls".
  for (let y = 0; y < maze.rows; y++) {
    for (let x = 0; x < maze.cols; x++) {
      if (maze.grid[y][x] !== 1) continue;
      const px = x * TILE, py = y * TILE;
      const onEdge = (x === 0 || x === maze.cols - 1 ||
                      y === 0 || y === maze.rows - 1);
      const tile = maze.wallTheme[y][x];
      if (!onEdge && tile && tile.pond) {
        drawPondCell(ctx, x, y, t);
        continue;
      }
      // Ground shadow under interior walls — soft ellipse well inside the
      // tile so it cues "obstacle here" for visually thin sprites without
      // bleeding into the corners (which previously read as "dark grass").
      if (!onEdge) {
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        ctx.beginPath();
        ctx.ellipse(px + TILE / 2, py + TILE - 8,
                    TILE / 2 - 6, TILE / 4 - 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      let drawTileT;
      if (onEdge) {
        const onTopBottom = (y === 0 || y === maze.rows - 1);
        drawTileT = onTopBottom ? BORDER_TILE_HORIZONTAL : BORDER_TILE_VERTICAL;
      } else {
        // Each interior cluster was assigned a single tile at gen time, so
        // every cell in that cluster renders identically.
        drawTileT = tile || WALL_THEMES.bushes[0];
      }
      drawTile(ctx, sheets.nature, drawTileT.col, drawTileT.row, px, py, TILE_SCALE);
    }
  }
}

function drawGrassDecor(ctx, tx, ty, h) {
  const cx = tx * TILE + TILE / 2;
  const cy = ty * TILE + TILE / 2;
  // Half-stable jitter so decor doesn't sit dead-center.
  const ox = ((h >> 4) % 17) - 8;
  const oy = ((h >> 8) % 17) - 8;
  const kind = h % 3; // 0,1 = flower, 2 = pebble
  ctx.save();
  if (kind === 2) {
    ctx.fillStyle = 'rgba(120, 120, 120, 0.7)';
    ctx.beginPath();
    ctx.arc(cx + ox, cy + oy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(80, 80, 80, 0.5)';
    ctx.beginPath();
    ctx.arc(cx + ox - 5, cy + oy + 3, 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const color = FLOWER_PALETTE[(h >> 12) % FLOWER_PALETTE.length];
    ctx.fillStyle = color;
    // Three petals + a yellow center.
    for (const [px, py] of [[-3, -2], [3, -2], [0, 3]]) {
      ctx.beginPath();
      ctx.arc(cx + ox + px, cy + oy + py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffeb3b';
    ctx.beginPath();
    ctx.arc(cx + ox, cy + oy, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPondCell(ctx, tx, ty, t) {
  const px = tx * TILE, py = ty * TILE;
  // Base water — soft cyan.
  ctx.save();
  ctx.fillStyle = '#3aa1c8';
  ctx.fillRect(px, py, TILE, TILE);
  // Lighter top band so the surface reads as water + horizon.
  const grad = ctx.createLinearGradient(px, py, px, py + TILE);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
  grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.04)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.18)');
  ctx.fillStyle = grad;
  ctx.fillRect(px, py, TILE, TILE);
  // Animated ripples — short white arcs that drift and fade with time.
  // Phase per cell so neighbouring tiles don't all blink in unison.
  const phase = ((tx * 73856093) ^ (ty * 19349663)) & 0xffff;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 2; i++) {
    const u = (t * 0.6 + phase * 0.0001 + i * 0.5) % 1;
    const ry = py + 8 + u * (TILE - 16);
    const rx = px + 10 + Math.sin((t + i + phase * 0.001) * 1.7) * 6;
    ctx.globalAlpha = Math.sin(u * Math.PI) * 0.7;
    ctx.beginPath();
    ctx.arc(rx + TILE / 2 - 14, ry, 5 + Math.sin(t * 2 + i) * 1.5, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }
  ctx.restore();
}
