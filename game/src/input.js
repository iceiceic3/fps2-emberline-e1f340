// Keyboard, mouse and pointer lock. Also trackpad-safe look fallback and a
// `sim` switch the deterministic capture path uses instead of real input.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const state = {
    keys, locked: false, firing: false, lookX: 0, lookY: 0,
    wantReload: false, wantNade: false, wantInteract: false,
    wantBuy: false, wantSlot1: false, wantSlot2: false,
    sim: false,
  };
  function setKey(e, down) {
    const c = e.code;
    if (down) {
      if (!e.repeat) {
        if (c === 'KeyR') state.wantReload = true;
        if (c === 'KeyG') state.wantNade = true;
        if (c === 'KeyE') state.wantInteract = true;
        if (c === 'KeyB') state.wantBuy = true;
        if (c === 'Digit1') state.wantSlot1 = true;
        if (c === 'Digit2') state.wantSlot2 = true;
      }
      keys.add(c);
    } else keys.delete(c);
    if (c === 'Space' || c === 'Tab') e.preventDefault();
  }
  window.addEventListener('keydown', (e) => setKey(e, true));
  window.addEventListener('keyup', (e) => setKey(e, false));
  window.addEventListener('blur', () => { keys.clear(); state.firing = false; });
  window.addEventListener('mousemove', (e) => {
    if (!state.locked || state.sim) return;
    state.lookX += e.movementX || 0;
    state.lookY += e.movementY || 0;
  });
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (state.locked && !state.sim) state.firing = true;
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) state.firing = false; });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) { keys.clear(); state.firing = false; }
    onLockChange(state.locked);
  });
  document.addEventListener('pointerlockerror', () => onLockChange(false));
  return {
    state,
    requestLock() {
      try {
        const p = canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => onLockChange(false));
      } catch { onLockChange(false); }
    },
    takeLook() {
      const x = state.lookX, y = state.lookY;
      state.lookX = 0; state.lookY = 0;
      return { x, y };
    },
  };
}
