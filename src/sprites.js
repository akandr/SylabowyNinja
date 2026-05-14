// Sprite sheets for the Ninja Adventure assets.
// All source sprites/tiles are 16x16; we scale at draw time.

const URLS = {
  idle: 'assets/ninja/idle.png',
  walk: 'assets/ninja/walk.png',
  floor: 'assets/tilesets/floor.png',
  nature: 'assets/tilesets/nature.png',
  house: 'assets/tilesets/house.png',
  squid: 'assets/enemies/squid_walk.png',
  squidGreen: 'assets/enemies/squid_green_walk.png',
  coin:       'assets/items/coin.png',
  freeze:     'assets/items/scroll_ice.png',
};

export const SRC = 16;

export const sheets = {
  idle:       { img: new Image(), loaded: false },
  walk:       { img: new Image(), loaded: false },
  floor:      { img: new Image(), loaded: false },
  nature:     { img: new Image(), loaded: false },
  house:      { img: new Image(), loaded: false },
  squid:      { img: new Image(), loaded: false },
  squidGreen: { img: new Image(), loaded: false },
  coin:       { img: new Image(), loaded: false },
  freeze:     { img: new Image(), loaded: false },
};

// Sprite-sheet layout for the ninja walk/idle sheets:
//   columns = facing direction, rows = animation frame.
export const DIR_COL = { down: 0, up: 1, left: 2, right: 3 };
// Kept for backward compatibility with code that still references rows.
export const DIR_ROW = DIR_COL;

function loadOne(sheet, url) {
  return new Promise(resolve => {
    sheet.img.onload = () => { sheet.loaded = true; resolve(true); };
    sheet.img.onerror = () => { sheet.loaded = false; resolve(false); };
    // Cache-bust on each session so updated sprite sheets are picked up
    // immediately (the browser was serving a stale walk.png).
    sheet.img.src = `${url}?v=${Date.now()}`;
  });
}

export function loadSprites() {
  return Promise.all(Object.entries(URLS).map(([k, url]) => loadOne(sheets[k], url)));
}

// Draw one 16x16 sprite from `sheet` (source col,row) centered at (cx,cy), scaled.
export function drawSprite(ctx, sheet, col, row, cx, cy, scale, flip = false) {
  if (!sheet.loaded) {
    ctx.fillStyle = '#1e64ff';
    ctx.beginPath(); ctx.arc(cx, cy, 12 * scale, 0, Math.PI * 2); ctx.fill();
    return;
  }
  const w = SRC * scale, h = SRC * scale;
  ctx.save();
  // Snap to integer pixels so adjacent 16x16 cells in tightly packed sheets
  // don't bleed in (was making the player appear to rotate while walking).
  ctx.translate(Math.round(cx), Math.round(cy));
  if (flip) ctx.scale(-1, 1);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet.img, col * SRC, row * SRC, SRC, SRC, -w / 2, -h / 2, w, h);
  ctx.restore();
}

// Draw a tile from a tileset at top-left (px,py), source col/row.
export function drawTile(ctx, sheet, col, row, px, py, scale) {
  if (!sheet.loaded) {
    ctx.fillStyle = '#3aa64a';
    ctx.fillRect(px, py, SRC * scale, SRC * scale);
    return;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet.img, col * SRC, row * SRC, SRC, SRC, px, py, SRC * scale, SRC * scale);
}

// Draw an arbitrary source rect from `sheet` to (dx,dy) at given scale.
// Centered=false → (dx,dy) is the top-left in destination coords.
// Centered=true  → (dx,dy) is the destination center.
export function drawRect(ctx, sheet, sx, sy, sw, sh, dx, dy, scale, centered = false) {
  if (!sheet.loaded) return;
  ctx.imageSmoothingEnabled = false;
  const dw = sw * scale, dh = sh * scale;
  const left = centered ? dx - dw / 2 : dx;
  const top  = centered ? dy - dh / 2 : dy;
  ctx.drawImage(sheet.img, sx, sy, sw, sh, left, top, dw, dh);
}
