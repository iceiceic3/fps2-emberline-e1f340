// All sound is synthesized with WebAudio: no audio files, no network.
// One graph per effect, short envelopes, master gain kept low.
export function createAudio() {
  let ctx = null;
  let master = null;
  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.24;
      master.connect(ctx.destination);
    } catch { return false; }
    return true;
  }
  function env(node, t0, peak, dur) {
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }
  function noiseBuffer(dur) {
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function shot(kind) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.16);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = kind === 'rifle' ? 2400 : kind === 'smg' ? 3600 : 1500;
    const g = ctx.createGain();
    env(g, t, kind === 'awp' ? 0.9 : 0.6, 0.15);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + 0.18);
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(kind === 'awp' ? 160 : 220, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
    const g2 = ctx.createGain();
    env(g2, t, 0.32, 0.11);
    o.connect(g2); g2.connect(master);
    o.start(t); o.stop(t + 0.12);
  }
  function beep(freq, dur, peak) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = ctx.createGain();
    env(g, t, peak || 0.3, dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  return {
    unlock() { ensure(); },
    rifle() { shot('rifle'); },
    smg() { shot('smg'); },
    awp() { shot('awp'); },
    foeShot(dist) {
      if (!ensure()) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.12);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = Math.max(400, 2000 - dist * 90);
      const g = ctx.createGain();
      env(g, t, Math.max(0.05, 0.4 - dist * 0.02), 0.12);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.14);
    },
    reload() { beep(520, 0.07, 0.2); setTimeout(() => beep(760, 0.07, 0.2), 90); },
    hit() { beep(1200, 0.05, 0.25); },
    kill() { beep(880, 0.08, 0.3); setTimeout(() => beep(1320, 0.1, 0.3), 80); },
    hurt() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(60, t + 0.18);
      const g = ctx.createGain();
      env(g, t, 0.4, 0.2);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.22);
    },
    plant() { beep(440, 0.12, 0.3); setTimeout(() => beep(440, 0.12, 0.3), 160); },
    beepTick() { beep(1000, 0.05, 0.35); },
    boom() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.7);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(900, t);
      f.frequency.exponentialRampToValueAtTime(60, t + 0.6);
      const g = ctx.createGain();
      env(g, t, 0.9, 0.65);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.7);
    },
    nade() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.3);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2500;
      const g = ctx.createGain();
      env(g, t, 0.3, 0.25);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.3);
    },
    round(win) {
      beep(win ? 660 : 330, 0.14, 0.3);
      setTimeout(() => beep(win ? 880 : 247, 0.2, 0.3), 150);
    },
    click() { beep(700, 0.04, 0.15); },
  };
}
