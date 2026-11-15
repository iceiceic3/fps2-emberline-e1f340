// The armoury: every gun is data in WEAPONS, one view model per slot, spread
// that punishes firing on the move, headshot multiplier on the ray.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  rifle: {
    name: 'VK-7 Carbine', price: 0, mag: 30, reserve: 120, gap: 0.105, reload: 1.9,
    dmg: 26, headMul: 3.2, range: 90, spread: 0.0024, moveSpread: 0.030,
    kick: 0.0115, auto: true, slot: 0,
    desc: 'Standard-issue carbine. Reliable at every range.',
  },
  smg: {
    name: 'Hornet-9 SMG', price: 1500, mag: 32, reserve: 128, gap: 0.068, reload: 1.6,
    dmg: 19, headMul: 2.6, range: 60, spread: 0.004, moveSpread: 0.022,
    kick: 0.0075, auto: true, slot: 0,
    desc: 'Fast hose for close lanes. Weak through distance.',
  },
  awp: {
    name: 'Longspur Rifle', price: 4750, mag: 5, reserve: 20, gap: 1.15, reload: 2.8,
    dmg: 110, headMul: 2.2, range: 140, spread: 0.0009, moveSpread: 0.075,
    kick: 0.05, auto: false, slot: 0,
    desc: 'One round decides a lane. Stand still or miss.',
  },
  pistol: {
    name: 'Sidearm P9', price: 0, mag: 12, reserve: 48, gap: 0.16, reload: 1.4,
    dmg: 18, headMul: 2.8, range: 50, spread: 0.003, moveSpread: 0.02,
    kick: 0.008, auto: false, slot: 1,
    desc: 'Last resort, always loaded.',
  },
};
// buy order shown in the menu (key, label)
export const BUY_LIST = [
  ['smg', '2 — Hornet-9 SMG'],
  ['awp', '3 — Longspur Rifle'],
  ['armor', '4 — Alloy vest (+50 armor)'],
  ['nade', '5 — Spark grenade'],
];
export const ARMOR_PRICE = 500;
export const NADE_PRICE = 300;
const SKIN = [0x2b262e, 0x4a3b28, 0x1c1a20];

export function createArmoury(camera) {
  const models = {};
  const mat = (c, r, m) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  function build(kind, tint) {
    const g = new THREE.Group();
    const dark = mat(SKIN[0], 0.6, 0.3);
    const wood = mat(tint, 0.7, 0.15);
    const grip = mat(SKIN[2], 0.8, 0.1);
    const recv = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, kind === 'awp' ? 0.5 : 0.42), dark);
    const barrel = new THREE.Mesh(
      new THREE.BoxGeometry(kind === 'awp' ? 0.035 : 0.045, 0.045, kind === 'smg' ? 0.3 : 0.5), wood);
    barrel.position.set(0, 0.03, kind === 'smg' ? -0.32 : -0.44);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.085, 0.22), grip);
    stock.position.set(0, -0.02, 0.3);
    g.add(recv, barrel, stock);
    if (kind === 'awp') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 10), dark);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.1, -0.05);
      g.add(scope);
    }
    if (kind === 'smg') {
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), grip);
      mag.position.set(0, -0.12, -0.05);
      mag.rotation.x = 0.25;
      g.add(mag);
    }
    g.position.set(0.24, -0.2, -0.42);
    g.visible = false;
    camera.add(g);
    return g;
  }
  models.rifle = build('rifle', SKIN[1]);
  models.smg = build('smg', 0x37424a);
  models.awp = build('awp', 0x5a2e1c);
  models.pistol = build('pistol', 0x333333);
  // muzzle flash + light shared across slots
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: PALETTE.ember, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(PALETTE.ember, 0, 6);
  flashLight.position.set(0.24, -0.15, -0.6);
  camera.add(flashLight);

  const ammo = {
    rifle: { mag: 30, reserve: 120 },
    smg: { mag: 0, reserve: 0 },
    awp: { mag: 0, reserve: 0 },
    pistol: { mag: 12, reserve: 48 },
  };
  const owned = { rifle: true, smg: false, awp: false, pistol: true };
  const state = {
    slot: 'rifle', cooldown: 0, reloadLeft: 0, reloadKind: null,
    flash: 0, kick: 0, nades: 0, triggerHeld: false,
  };
  const MUZZLE_T = 0.06;

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 13);
    const m = models[state.slot];
    if (m) {
      m.position.z = -0.42 + state.kick;
      m.rotation.x = state.kick * 2.4;
      if (state.reloadLeft > 0) {
        state.reloadLeft = Math.max(0, state.reloadLeft - dt);
        m.rotation.x = -0.55 * Math.min(1, (WEAPONS[state.reloadKind || state.slot].reload - state.reloadLeft) * 2);
        if (state.reloadLeft === 0 && state.reloadKind) {
          const w = WEAPONS[state.reloadKind];
          const a = ammo[state.reloadKind];
          const need = w.mag - a.mag;
          const take = Math.min(need, a.reserve);
          a.mag += take; a.reserve -= take;
          state.reloadKind = null;
        }
      }
    }
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 20 : 0;
  }
  function show() {
    for (const k of Object.keys(models)) models[k].visible = (k === state.slot);
  }
  show();
  return {
    state, ammo, owned,
    spec() { return WEAPONS[state.slot]; },
    step,
    ready() {
      return ammo[state.slot].mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    // returns true when a round left the barrel (caller runs the ray)
    fire(autoHeld) {
      const w = WEAPONS[state.slot];
      const a = ammo[state.slot];
      if (state.reloadLeft > 0 || state.cooldown > 0) return false;
      if (!w.auto && state.triggerHeld) return false;
      if (a.mag <= 0) return false;
      a.mag -= 1;
      state.cooldown = w.gap;
      state.flash = MUZZLE_T;
      state.kick = w.slot === 0 && state.slot === 'awp' ? 0.09 : 0.055;
      state.triggerHeld = true;
      void autoHeld;
      return true;
    },
    releaseTrigger() { state.triggerHeld = false; },
    reload() {
      const w = WEAPONS[state.slot];
      const a = ammo[state.slot];
      if (state.reloadLeft > 0 || a.mag >= w.mag || a.reserve <= 0) return false;
      state.reloadLeft = w.reload;
      state.reloadKind = state.slot;
      return true;
    },
    spreadOf(speed) {
      const w = WEAPONS[state.slot];
      return w.spread + Math.min(1, speed / 5.4) * w.moveSpread;
    },
    select(slot) {
      if (!owned[slot] || state.reloadLeft > 0) return false;
      if (state.slot === slot) return false;
      state.slot = slot;
      state.cooldown = Math.max(state.cooldown, 0.25);
      show();
      return true;
    },
    buy(kind, store) {
      if (kind === 'armor') {
        if (store.money < ARMOR_PRICE || store.player.armor >= 100) return false;
        store.money -= ARMOR_PRICE;
        store.player.armor = Math.min(100, store.player.armor + 50);
        return true;
      }
      if (kind === 'nade') {
        if (store.money < NADE_PRICE || state.nades >= 2) return false;
        store.money -= NADE_PRICE;
        state.nades += 1;
        return true;
      }
      const w = WEAPONS[kind];
      if (!w || owned[kind] || store.money < w.price) return false;
      store.money -= w.price;
      owned[kind] = true;
      ammo[kind].mag = w.mag;
      ammo[kind].reserve = w.reserve;
      state.slot = kind;
      show();
      return true;
    },
    refillRound() {
      const wr = WEAPONS.rifle, wp = WEAPONS.pistol;
      ammo.rifle.mag = wr.mag; ammo.rifle.reserve = wr.reserve;
      ammo.pistol.mag = wp.mag; ammo.pistol.reserve = wp.reserve;
      if (!owned[state.slot]) { state.slot = 'rifle'; show(); }
      state.cooldown = 0; state.reloadLeft = 0; state.reloadKind = null;
      state.nades = 0;
    },
  };
}
