// Lightweight sound-effect player using Web Audio API. Shares the AudioContext
// with tts.js so a single user-gesture unlock primes everything. Buffers are
// decoded once and can be played multiple times overlapping by spawning fresh
// BufferSource nodes.

import { getAudioContext } from './tts.js?v=78';

let muted = false;
let volume = 0.6;

const SFX = {
  pickup:       'audio/sfx/pickup.ogg',
  eat:          'audio/sfx/eat.ogg',
  spawn:        'audio/sfx/spawn.ogg',
  freeze_spawn: 'audio/sfx/freeze_spawn.ogg',
  power_diamond:'audio/sfx/power_diamond.ogg',
  power_freeze: 'audio/sfx/power_freeze.ogg',
  power_end:    'audio/sfx/power_end.ogg',
};

const buffers = new Map(); // name -> AudioBuffer

export async function preloadSfx() {
  const ctx = getAudioContext();
  if (!ctx) return;
  await Promise.all(Object.entries(SFX).map(async ([name, url]) => {
    try {
      const r = await fetch(url, { cache: 'force-cache' });
      if (!r.ok) return;
      const bytes = await r.arrayBuffer();
      const buf = await new Promise((resolve, reject) => {
        try {
          const p = ctx.decodeAudioData(bytes.slice(0), resolve, reject);
          if (p && typeof p.then === 'function') p.then(resolve, reject);
        } catch (e) { reject(e); }
      });
      buffers.set(name, buf);
    } catch (e) {
      console.warn('[sfx] preload failed', url, e && e.name);
    }
  }));
}

export function playSfx(name, { volumeMul = 1 } = {}) {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const buf = buffers.get(name);
  if (!buf) return;
  try {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = volume * volumeMul;
    src.connect(g).connect(ctx.destination);
    src.start(0);
  } catch (_) {}
}

export function setSfxMuted(m) { muted = !!m; }

export function setSfxVolume(v) {
  volume = Math.max(0, Math.min(1, v));
}
