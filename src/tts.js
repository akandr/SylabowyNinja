// Polish syllable audio.
// Primary: pre-rendered WAVs in /audio (built by tools/build_audio.sh, voice: Zosia).
// Fallback: Web Speech API in pl-PL (used only if a WAV is missing).

import { canonical } from './syllables.js?v=79';

const AUDIO_DIR = 'audio/';
let voice = null;
let muted = false;
let currentText = null;
let timer = null;

// Idle-driven nudges instead of a fixed loop:
// - speak once at start (handled by setTarget),
// - after FIRST_NUDGE_MS of no activity, speak again,
// - after that, speak again every NUDGE_MS until the player picks something
//   up (any pickup, correct or not, calls noteActivity() to reset the timer).
// Schedule is intentionally sparse so the audio doesn't get annoying — the
// kid plays mostly by ear and can press space / tap to hear the target on
// demand at any time.
const FIRST_NUDGE_MS = 5000;    // first re-prompt 5 s after target is set
const NUDGE_MS = 20000;         // afterwards, only every 20 s
let lastActivityAt = 0;
let nudgesSinceActivity = 0;

// Timestamp (performance.now()) until which the looping target speech is
// suppressed. Used so feedback words ("brawo", "pomyłka", milestones) play
// cleanly without the target word starting on top.
let holdUntil = 0;

// Cache decoded AudioBuffers per syllable. `null` = file confirmed missing.
// Web Audio API is used instead of <audio> elements because mobile browsers
// (esp. Firefox Android) refuse to play HTMLAudioElement reliably after an
// async preload — but a resumed AudioContext plays buffers freely.
const cache = new Map();          // key -> AudioBuffer | null
const playingSources = new Map(); // key -> currently-playing BufferSource
let _ctx = null;
let _gain = null;

function getCtx() {
  if (_ctx) return _ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  _ctx = new Ctx();
  _gain = _ctx.createGain();
  _gain.gain.value = 1.0;
  _gain.connect(_ctx.destination);
  return _ctx;
}

function pickPolishVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = speechSynthesis.getVoices();
  return (
    voices.find(v => v.lang === 'pl-PL') ||
    voices.find(v => v.lang && v.lang.toLowerCase().startsWith('pl')) ||
    null
  );
}

export function initTTS() {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) { resolve(true); return; }
    voice = pickPolishVoice();
    if (voice) { resolve(true); return; }
    speechSynthesis.onvoiceschanged = () => { voice = pickPolishVoice(); };
    setTimeout(() => resolve(true), 400);
  });
}

// When true, fall back to Web Speech API if a recording can't load/play.
// Kept ON: it's a useful safety net (e.g. a brand-new syllable added to a
// set before the WAV is recorded). Console warnings flag the gap so we know
// what's missing.
const SYNTH_FALLBACK = true;

// Convert a canonical key to an ASCII-safe filename (without extension).
// Polish diacritics are transliterated; ą→aq, ę→eq to avoid collision with
// plain a/e syllables. Spaces become underscores, other specials are dropped.
function sanitizeFilename(key) {
  return key
    .toLowerCase()
    .replace(/ą/g, 'aq')
    .replace(/ę/g, 'eq')
    .replace(/ć/g, 'c')
    .replace(/ł/g, 'l')
    .replace(/ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/ź/g, 'z')
    .replace(/ż/g, 'z')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function getAudio(text) {
  // Map homophones to a single canonical key (e.g. "pó" -> "pu"). Returns
  // the cached AudioBuffer, or null if known-missing, or undefined if not
  // yet prefetched.
  const key = canonical(text);
  return cache.has(key) ? cache.get(key) : undefined;
}

function speakViaSynth(text) {
  if (!SYNTH_FALLBACK) return;
  if (!('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pl-PL';
    if (voice) u.voice = voice;
    u.rate = 0.7;
    speechSynthesis.speak(u);
  } catch (_) {}
}

// Plays `text` once. Returns the playback duration in milliseconds (best
// effort): the buffer's `duration` if loaded, or 0 when we have to fall
// back to speech synthesis (whose duration we can't easily know upfront).
export function speakOnce(text) {
  if (muted || !text) return 0;
  const key = canonical(text);
  const buf = getAudio(text);
  if (buf === null || buf === undefined) {
    speakViaSynth(text);
    return 0;
  }
  const ctx = getCtx();
  if (!ctx) { speakViaSynth(text); return 0; }
  try {
    // Stop any currently-playing instance of this key (so re-prompts don't stack).
    const prev = playingSources.get(key);
    if (prev) { try { prev.stop(); } catch (_) {} }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(_gain);
    src.onended = () => {
      if (playingSources.get(key) === src) playingSources.delete(key);
    };
    src.start(0);
    playingSources.set(key, src);
    return (buf.duration || 0) * 1000;
  } catch (e) {
    console.warn('[tts] BufferSource.start failed for', JSON.stringify(text), e && e.name);
    speakViaSynth(text);
    return 0;
  }
}

// Unlock audio playback by creating/resuming the AudioContext while we
// still have user-gesture activation. Mobile browsers (Firefox Android, iOS
// Safari) require this — once an AudioContext has been resumed inside a
// gesture, every BufferSource plays freely without further restrictions.
export function unlockAudio() {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
    // Play a 1-sample silent buffer to fully prime mobile WebKit / FF.
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch (_) {}
}

// Expose the live AudioContext (creating one on demand) so other modules
// (sfx, music) can share the same gesture-granted context.
export function getAudioContext() { return getCtx(); }



// Convenience: speak `text` and hold the target loop for the audio's
// duration plus `gapMs` (so the next target word never starts on top).
// Returns the hold duration so the caller can chain delayed actions.
export function speakWithHold(text, gapMs = 250) {
  const dur = speakOnce(text);
  // Fallback estimate when duration is unknown (synth fallback / not yet
  // loaded): 600 ms for short words, longer for phrases with spaces.
  const fallback = text.includes(' ') ? 1700 : 600;
  const hold = (dur || fallback) + gapMs;
  holdTarget(hold);
  return hold;
}

export function setTarget(text, { speakImmediately = true } = {}) {
  currentText = text;
  if (speakImmediately) speakOnce(text);
  // Reset the idle-nudge tracker every time the target changes.
  lastActivityAt = performance.now();
  nudgesSinceActivity = 0;
  if (timer) clearInterval(timer);
  // Tick once a second; the handler decides whether enough idle time has
  // passed to re-speak the target.
  timer = setInterval(() => {
    if (!currentText) return;
    const now = performance.now();
    if (now < holdUntil) return; // muted briefly during feedback
    const idle = now - lastActivityAt;
    const due = nudgesSinceActivity === 0 ? FIRST_NUDGE_MS : NUDGE_MS;
    if (idle >= due) {
      speakOnce(currentText);
      // Reset idle window so we wait `NUDGE_MS` until the next nudge,
      // not just one tick.
      lastActivityAt = now;
      nudgesSinceActivity++;
    }
  }, 1000);
}

// Call this on any pickup (correct or wrong) to defer the next nudge.
export function noteActivity() {
  lastActivityAt = performance.now();
  nudgesSinceActivity = 0;
}

// Suppress the looping target speech for `ms` milliseconds AND stop any
// target audio that's currently playing, so a feedback word ("brawo",
// "pomyłka", milestone) is heard cleanly. Does not affect speakOnce calls
// you make for the feedback itself.
export function holdTarget(ms) {
  holdUntil = Math.max(holdUntil, performance.now() + ms);
  // Stop the currently-looping target syllable only — leave any feedback
  // word (brawo / pomyłka / milestone) that the caller is about to start
  // (or has just started) untouched.
  if (currentText) {
    const key = canonical(currentText);
    const src = playingSources.get(key);
    if (src) {
      try { src.stop(); } catch (_) {}
      playingSources.delete(key);
    }
  }
  if ('speechSynthesis' in window) {
    try { speechSynthesis.cancel(); } catch (_) {}
  }
}

export function clearTarget() {
  const prevText = currentText;
  currentText = null;
  if (timer) { clearInterval(timer); timer = null; }
  holdUntil = 0;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  // Stop ONLY the looping target syllable, not any feedback word that may
  // be playing right now (e.g. "brawo, 100 punktów!" started just before
  // winGame() called clearTarget()).
  if (prevText) {
    const key = canonical(prevText);
    const src = playingSources.get(key);
    if (src) {
      try { src.stop(); } catch (_) {}
      playingSources.delete(key);
    }
  }
}

export function setMuted(m) {
  muted = !!m;
  if (muted) {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    stopAllSources();
  }
}

function stopAllSources() {
  for (const src of playingSources.values()) {
    try { src.stop(); } catch (_) {}
  }
  playingSources.clear();
}

export function isMuted() { return muted; }

// Expose the cache (decoded AudioBuffers) — currently unused externally.
export function cacheValues() { return cache.values(); }

// Build the full list of audio keys a game session will need.
function allKeysForSession(syllables) {
  const keys = new Set();
  // Syllables (via canonical mapping)
  for (const s of syllables) keys.add(canonical(s));
  // Feedback words
  keys.add('brawo');
  keys.add('pomy\u0142ka');
  keys.add('aua');
  // Milestone announcements
  for (let n = 10; n <= 100; n += 10) keys.add(`brawo, ${n} punkt\u00f3w!`);
  return keys;
}

// Prefetch all audio files for a given syllable set.
// `onProgress({ loaded, total, attempt, maxAttempts })` is called periodically.
// Retries failed files up to `maxAttempts` times.
// Resolves to { ok: string[], failed: string[] }.
//
// We fetch bytes and decode them into AudioBuffers via Web Audio. This is
// the most reliable cross-platform approach: HTMLAudioElement has too many
// mobile autoplay quirks, but AudioContext + BufferSource plays freely
// once the context is resumed inside a user gesture.
export async function prefetchAll(syllables, { onProgress, maxAttempts = 5, concurrency = 6 } = {}) {
  const allKeys = [...allKeysForSession(syllables)];
  const total = allKeys.length;
  const okSet = new Set();
  let pending = allKeys;

  async function loadOne(key) {
    const url = AUDIO_DIR + sanitizeFilename(key) + '.ogg';
    try {
      const r = await fetch(url, { cache: 'force-cache' });
      if (!r.ok) return false;
      const bytes = await r.arrayBuffer();
      if (!bytes || bytes.byteLength === 0) return false;
      const ctx = getCtx();
      if (!ctx) return false;
      // decodeAudioData with both promise and callback signatures (Safari).
      const buf = await new Promise((resolve, reject) => {
        try {
          const p = ctx.decodeAudioData(bytes.slice(0), resolve, reject);
          if (p && typeof p.then === 'function') p.then(resolve, reject);
        } catch (e) { reject(e); }
      });
      cache.set(key, buf);
      return true;
    } catch (e) {
      console.warn('[tts] decode failed', url, e && (e.name || e.message));
      return false;
    }
  }

  async function runPool(keys) {
    const results = new Map();
    let i = 0;
    async function worker() {
      while (i < keys.length) {
        const idx = i++;
        const key = keys[idx];
        const ok = await loadOne(key);
        results.set(key, ok);
        if (ok) okSet.add(key);
        if (onProgress) {
          onProgress({ loaded: okSet.size, total, attempt: 0, maxAttempts });
        }
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, keys.length) }, worker);
    await Promise.all(workers);
    return results;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      for (const key of pending) cache.delete(key);
    }
    if (onProgress) {
      onProgress({ loaded: okSet.size, total, attempt, maxAttempts });
    }
    const results = await runPool(pending);
    const newFailed = pending.filter(k => !results.get(k));
    if (newFailed.length === 0) break;
    pending = newFailed;
    console.warn(`[tts] prefetch attempt ${attempt}/${maxAttempts}: ${newFailed.length} failed`, newFailed);
    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  const ok = [...okSet];
  const failed = pending.filter(k => !okSet.has(k));
  return { ok, failed };
}

// Legacy convenience (kept for compatibility).
// Legacy convenience (kept for compatibility) — no-op now, prefetchAll() handles loading.
export function preload(_items) {}
