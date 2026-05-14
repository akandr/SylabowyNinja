// Lightweight particle effects spawned at pickup positions.
// Two flavors:
//   spawnGood(x,y) — golden sparkles + radial burst (correct pickup)
//   spawnBad(x,y)  — red/grey smoke puff (wrong pickup)
//
// Particles are plain objects in a single global list. update(dt) advances
// them and prunes dead ones; draw(ctx) renders all of them.

const particles = [];

export function spawnGood(x, y) {
  // Bright outward spark burst (fireworks-y).
  const N = 22;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + Math.random() * 0.3;
    const speed = 90 + Math.random() * 110;
    particles.push({
      kind: 'spark',
      x, y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      life: 0.55 + Math.random() * 0.25,
      age: 0,
      size: 3 + Math.random() * 2,
      hue: 40 + Math.random() * 25, // gold/yellow
    });
  }
  // A few slower stars on top.
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = 30 + Math.random() * 40;
    particles.push({
      kind: 'star',
      x, y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed - 30,
      life: 0.9,
      age: 0,
      size: 6,
      hue: 50,
    });
  }
}

export function spawnBad(x, y) {
  // Grey/red smoke puff rising and fading.
  const N = 14;
  for (let i = 0; i < N; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
    const speed = 25 + Math.random() * 45;
    particles.push({
      kind: 'smoke',
      x: x + (Math.random() - 0.5) * 10,
      y: y + (Math.random() - 0.5) * 6,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      life: 0.7 + Math.random() * 0.4,
      age: 0,
      size: 10 + Math.random() * 8,
      red: Math.random() < 0.4, // some embers are reddish
    });
  }
  // A red "X" flash made of two crossed lines (drawn as fading slashes).
  particles.push({
    kind: 'cross', x, y, vx: 0, vy: 0, life: 0.35, age: 0, size: 22,
  });
}

// Quick expanding ring + a few sparkles, used when a syllable disk
// disappears at pickup time. Cheap and readable: makes the disappearance
// feel intentional instead of just "warping" away.
export function spawnPop(x, y, color = '#ffd84d') {
  particles.push({
    kind: 'ring', x, y, vx: 0, vy: 0,
    life: 0.35, age: 0, size: 26, color,
  });
  // A handful of tiny sparkles outwards, same color family.
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const speed = 60 + Math.random() * 30;
    particles.push({
      kind: 'spark',
      x, y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      life: 0.35,
      age: 0,
      size: 2.5,
      hue: 50,
    });
  }
}

export function updateEffects(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.life) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    // Gravity / drag per kind.
    if (p.kind === 'spark') { p.vy += 220 * dt; p.vx *= (1 - 0.8 * dt); }
    else if (p.kind === 'star') { p.vy += 90 * dt; }
    else if (p.kind === 'smoke') { p.vx *= (1 - 0.6 * dt); p.vy *= (1 - 0.4 * dt); }
  }
}

export function drawEffects(ctx) {
  for (const p of particles) {
    const t = p.age / p.life;
    const alpha = Math.max(0, 1 - t);
    ctx.save();
    if (p.kind === 'spark') {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `hsl(${p.hue}, 100%, ${60 + 20 * (1 - t)}%)`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - 0.4 * t), 0, Math.PI * 2); ctx.fill();
    } else if (p.kind === 'star') {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `hsl(${p.hue}, 100%, 70%)`;
      drawStar(ctx, p.x, p.y, p.size * (1 - 0.3 * t));
    } else if (p.kind === 'smoke') {
      ctx.globalAlpha = alpha * 0.7;
      ctx.fillStyle = p.red ? `rgb(${180 - 60 * t}, ${60 - 30 * t}, ${40 - 20 * t})`
                            : `rgb(${110 - 30 * t}, ${110 - 30 * t}, ${110 - 30 * t})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + 0.7 * t), 0, Math.PI * 2); ctx.fill();
    } else if (p.kind === 'cross') {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#e23b3b';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      const s = p.size;
      ctx.beginPath();
      ctx.moveTo(p.x - s, p.y - s); ctx.lineTo(p.x + s, p.y + s);
      ctx.moveTo(p.x + s, p.y - s); ctx.lineTo(p.x - s, p.y + s);
      ctx.stroke();
    } else if (p.kind === 'ring') {
      // Expanding ring outline that fades as it grows.
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 4 * (1 - t);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + 1.6 * t), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawStar(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.45;
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

export function clearEffects() { particles.length = 0; }
