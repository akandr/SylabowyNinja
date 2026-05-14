// Keyboard + on-screen D-pad input. Returns a live `dir` object the game reads.
// `dir.lastPressed` tracks the most recently pressed direction so grid
// movement can prioritize the latest intent when multiple keys are held.

export function createInput() {
  const dir = { up: false, down: false, left: false, right: false, lastPressed: null };

  function press(k) { dir[k] = true; dir.lastPressed = k; }
  function release(k) {
    dir[k] = false;
    if (dir.lastPressed === k) {
      // Fall back to any other still-held direction.
      dir.lastPressed = ['up', 'down', 'left', 'right'].find(n => dir[n]) || null;
    }
  }

  const keymap = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  };
  const onKey = (down) => (e) => {
    const k = keymap[e.code];
    if (!k) return;
    if (down) press(k); else release(k);
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey(true));
  window.addEventListener('keyup', onKey(false));

  // D-pad (touch + mouse).
  const dpad = document.getElementById('dpad');
  if (dpad) {
    const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (isTouch) dpad.classList.remove('hidden');
    dpad.querySelectorAll('button[data-dir]').forEach(btn => {
      const d = btn.getAttribute('data-dir');
      const onPress = (v) => (e) => { v ? press(d) : release(d); e.preventDefault(); };
      btn.addEventListener('touchstart', onPress(true),  { passive: false });
      btn.addEventListener('touchend',   onPress(false), { passive: false });
      btn.addEventListener('touchcancel',onPress(false), { passive: false });
      btn.addEventListener('mousedown',  onPress(true));
      btn.addEventListener('mouseup',    onPress(false));
      btn.addEventListener('mouseleave', onPress(false));
    });
  }

  function reset() {
    dir.up = dir.down = dir.left = dir.right = false;
    dir.lastPressed = null;
  }
  window.addEventListener('blur', reset);

  return { dir, reset };
}
