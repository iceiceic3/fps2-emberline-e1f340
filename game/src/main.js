// Boot: renderer, fixed-step simulation vs render split, the live loop.
// ?shot=start|buy|play|war|end&seed=N renders a frozen deterministic frame and
// sets window.__shotReady. ?autoplay=1 plays itself for live capture.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createStore, PHASE } from './store.js';
import { createWorld, SITES_POS } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createArmoury } from './weapons.js';
import { createBots } from './bots.js';
import { createRounds, ROUND_TIME, BOMB_TICK } from './rounds.js';
import { createHud } from './hud.js';
import { createFx } from './fx.js';
import { createGrenades } from './grenades.js';
import { createAudio } from './audio.js';

const FIXED = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') || '1', 10) || 1;
const autoplay = params.get('autoplay') === '1';

function mulberry(initial) {
  let a = initial | 0;
  return function rnd() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const store = createStore();
const audio = createAudio();
const world = createWorld(scene);
const fx = createFx(scene);
const armoury = createArmoury(camera);
const input = createInput(renderer.domElement, onLockChange);
const player = createPlayer(world.colliders, store);
const bots = createBots(scene, world.colliders, store);
const grenades = createGrenades(scene, world.colliders, world.shootables);
const hud = createHud(store, armoury);

const raycaster = new THREE.Raycaster();
const camDir = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const botCenter = new THREE.Vector3();
let rounds = null;

let accumulator = 0;
let lastTime = performance.now();
let frozen = false;
let started = false;
let elapsed = 0;
let playerSpeed = 0;
let hurtCooldown = 0;

const fxBridge = {
  audio,
  onBuy() { hud.setBuyOpen(true, store.round); hud.refreshBuy(); },
  onLive() { hud.setBuyOpen(false); },
  onPlant(s, byPlayer) {
    audio.plant();
    hud.feed(byPlayer ? 'You planted the charge on <b>' + s.bomb.site + '</b>' : 'Charge planted on <b>' + s.bomb.site + '</b>!', !byPlayer);
    hud.showBanner(!byPlayer, byPlayer ? 'CHARGE PLANTED' : 'CHARGE PLANTED', byPlayer ? 'Defend it.' : 'Defuse it before it blows!', 3);
  },
  onBoom(s) {
    audio.boom();
    fx.boom(tmpV.set(s.bomb.pos[0], 1, s.bomb.pos[2]));
    fx.shakeIt(0.09);
    hud.showBanner(false, 'DETONATION', 'The vault is gone.', 3);
  },
  onRoundEnd(s, winner) {
    hud.setBuyOpen(false);
    hud.showBanner(winner === 0, s.banner.title, s.banner.sub + '  [$' + s.money + ']', 3.6);
  },
  onMatchEnd(s) {
    const win = s.wins[0] > s.wins[1];
    const copy = 'Final ' + s.wins[0] + ' — ' + s.wins[1] + '. ' + (win ? 'The foundry holds.' : 'The raiders take the vaults.');
    document.getElementById('match-copy').textContent = copy;
    document.getElementById('matchend').hidden = false;
    hud.showBanner(win, win ? 'MATCH WON' : 'MATCH LOST', copy, 600);
  },
};
rounds = createRounds(store, bots, armoury, fxBridge);

function damagePlayer(amount, fromX, fromZ) {
  const p = store.player;
  if (!p.alive || store.phase !== PHASE.LIVE) return;
  hurtCooldown = hurtCooldown; // read each frame; set below
  let rest = amount;
  if (p.armor > 0) {
    const absorbed = Math.min(p.armor, rest * 0.6);
    p.armor -= absorbed;
    rest -= absorbed;
  }
  p.hp -= rest;
  audio.hurt();
  fx.shakeIt(0.03);
  const dx = fromX - p.pos[0], dz = fromZ - p.pos[2];
  const worldYaw = Math.atan2(-dx, -dz);
  hud.damageFlash(worldYaw - p.yaw + Math.PI);
  if (p.hp <= 0) {
    p.hp = 0; p.alive = false;
    hud.feed('You were dropped.', true);
  }
}

function foeHitscan(b, dist, aimErr) {
  const p = store.player;
  audio.foeShot(dist);
  tmpV.set(b.pos.x, 1.45, b.pos.z);
  tmpV2.set(p.pos[0], p.pos[1] + p.eye * 0.82, p.pos[2]);
  fx.tracer(tmpV, tmpV2, true);
  // walk the ray: miss chance grows with error; crouch/cover help
  const roll = rnd();
  if (roll > aimErr) return; // clean miss past the shoulder
  // body part: 22% head
  const head = rnd() < 0.22;
  let dmg = head ? 34 : 13;
  dmg *= Math.max(0.45, 1 - dist / 60);
  damagePlayer(dmg, b.pos.x, b.pos.z);
  hud.feed('<b>' + b.name + '</b> hit you' + (head ? ' (head)' : ''), true);
}

function playerShoot() {
  const spec = armoury.spec();
  if (!armoury.fire()) {
    if (armoury.ammo[armoury.state.slot].mag <= 0 && armoury.state.cooldown <= 0) {
      armoury.reload() && audio.reload();
    }
    return;
  }
  audio[armoury.state.slot === 'smg' ? 'smg' : armoury.state.slot === 'awp' ? 'awp' : 'rifle']();
  const spread = armoury.spreadOf(playerSpeed);
  camera.getWorldDirection(camDir);
  camDir.x += (rnd() * 2 - 1) * spread;
  camDir.y += (rnd() * 2 - 1) * spread;
  camDir.z += (rnd() * 2 - 1) * spread;
  camDir.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, camDir);
  raycaster.far = spec.range;
  const targets = world.shootables.concat(bots.hitMeshes);
  const hit = raycaster.intersectObjects(targets, false)[0];
  const muzzle = tmpV.copy(camera.position).addScaledVector(camDir, 1.2);
  if (hit) {
    fx.tracer(muzzle, hit.point, false);
    fx.puff(hit.point, !!hit.object.userData.bot);
    if (hit.object.userData.bot) {
      const part = hit.object.userData.part;
      const dmg = spec.dmg * (part === 'head' ? spec.headMul : 1);
      const killed = bots.damage(hit.object, dmg);
      if (killed) {
        audio.kill();
        hud.hit(true);
        rounds.awardKill();
        hud.feed('You dropped <b>' + hit.object.userData.bot.name + '</b>' + (part === 'head' ? ' — HEADSHOT' : ''), false);
      } else {
        audio.hit();
        hud.hit(false);
      }
    }
  } else {
    tmpV2.copy(camera.position).addScaledVector(camDir, 40);
    fx.tracer(muzzle, tmpV2, false);
  }
  player.recoil(spec.kick * (0.85 + rnd() * 0.3), (rnd() * 2 - 1) * spec.kick * 0.35);
  bots.hear(store.player.pos[0], store.player.pos[2]);
  rounds.checkWin();
}

function throwPlayerNade() {
  if (armoury.state.nades <= 0 || store.phase !== PHASE.LIVE) return;
  armoury.state.nades--;
  camera.getWorldDirection(camDir);
  tmpV.copy(camera.position).addScaledVector(camDir, 0.6);
  grenades.throwNade(tmpV, camDir);
  audio.nade();
  bots.hear(store.player.pos[0], store.player.pos[2]);
}

// near-site test: plant only inside a vault ring
function nearSite() {
  const p = store.player;
  for (const site of ['A', 'B']) {
    const sp = SITES_POS[site];
    const d = Math.hypot(p.pos[0] - sp.x, p.pos[2] - sp.z);
    if (d < 2.6) return site;
  }
  return null;
}
function nearBomb() {
  if (store.bomb.state !== 'ticking' || !store.bomb.pos) return false;
  const p = store.player;
  return Math.hypot(p.pos[0] - store.bomb.pos[0], p.pos[2] - store.bomb.pos[2]) < 2.2;
}

function step(dt) {
  elapsed += dt;
  hurtCooldown = Math.max(0, hurtCooldown - dt);
  world.step(elapsed);
  rounds.step(dt);
  if (store.phase === PHASE.BUY || store.phase === PHASE.OVER) {
    hud.setBuyOpen(store.phase === PHASE.BUY, store.round);
    return;
  }
  if (store.phase !== PHASE.LIVE) return;

  const st = input.state;
  if (!st.sim) {
    const look = input.takeLook();
    if (store.player.alive) player.look(look.x, look.y);
  }
  // weapon keys
  if (st.wantSlot1) { st.wantSlot1 = false; armoury.select('rifle') || armoury.select('pistol'); }
  if (st.wantSlot2) { st.wantSlot2 = false; armoury.select('pistol'); }
  if (st.wantReload) { st.wantReload = false; if (armoury.reload()) audio.reload(); }
  if (st.wantNade) { st.wantNade = false; throwPlayerNade(); }
  if (st.wantBuy) { st.wantBuy = false; }
  armoury.step(dt);
  if (st.firing && store.player.alive) playerShoot();
  if (!st.firing) armoury.releaseTrigger();

  // movement (dead players spectate: no move)
  if (store.player.alive) player.step(dt, st.keys);
  playerSpeed = player.speed2d();

  // plant channel (player carries the charge when a site is free)
  const site = nearSite();
  if (store.bomb.state === 'idle' && st.keys.has('KeyE') && store.player.alive && site) {
    if (!store.plant.active) { store.plant.active = true; store.plant.t = 0; }
    store.plant.t += dt;
    if (store.plant.t >= store.plant.need) {
      store.plant.active = false;
      store.bomb.state = 'ticking';
      store.bomb.site = site;
      store.bomb.pos = [SITES_POS[site].x, 0.35, SITES_POS[site].z];
      rounds.awardPlant();
      fxBridge.onPlant(store, true);
    }
  } else store.plant.active = false;
  // defuse channel
  if (store.bomb.state === 'ticking' && st.keys.has('KeyE') && store.player.alive && nearBomb()) {
    if (!store.defuse.active) { store.defuse.active = true; store.defuse.t = 0; }
    store.defuse.t += dt;
    if (store.defuse.t >= store.defuse.need) {
      store.defuse.active = false;
      store.bomb.state = 'idle';
      store.bomb.tickT = 0;
      rounds.endRound(0, 'Charge defused with ' + Math.max(0, Math.ceil(store.timer)) + 's left.');
    }
  } else store.defuse.active = false;

  // bots + their shots
  botCenter.set(store.player.pos[0], store.player.pos[1] + store.player.eye, store.player.pos[2]);
  bots.update(dt, elapsed, botCenter, store.player.alive && !shot, store.player.crouching, playerSpeed, store.bomb.state === 'ticking');
  for (const e of bots.events.splice(0)) {
    if (e.type === 'shot' && store.player.alive) foeHitscan(e.bot, e.dist, e.aimErr);
  }
  // grenades
  tmpV.set(store.player.pos[0], store.player.pos[1] + store.player.eye, store.player.pos[2]);
  grenades.update(dt, bots, tmpV, store.player.alive, (hits, at) => {
    audio.boom();
    fx.boom(at);
    fx.shakeIt(0.05);
    for (const h of hits) {
      if (h.kind === 'bot') {
        const killed = bots.damage({ userData: { bot: h.bot } }, h.amount);
        fx.puff(new THREE.Vector3(h.bot.pos.x, 1.2, h.bot.pos.z), true);
        if (killed) {
          audio.kill(); hud.hit(true); rounds.awardKill();
          hud.feed('Fragged <b>' + h.bot.name + '</b> with a spark', false);
        } else { audio.hit(); hud.hit(false); }
      } else {
        damagePlayer(h.amount, at.x, at.z);
      }
    }
    rounds.checkWin();
  });
  // bomb beeps accelerate
  if (store.bomb.state === 'ticking') {
    const rate = store.bomb.tickT > BOMB_TICK - 10 ? 0.25 : 0.7;
    store.bomb._beep = (store.bomb._beep || 0) + dt;
    if (store.bomb._beep >= rate) { store.bomb._beep = 0; audio.beepTick(); }
    world.charge.visible = true;
    world.charge.position.set(store.bomb.pos[0], 0.5 + Math.sin(elapsed * 8) * 0.05, store.bomb.pos[2]);
  } else world.charge.visible = false;

  rounds.checkWin();
}

function syncCamera() {
  const p = store.player;
  const sh = fx.shakeOf();
  camera.position.set(p.pos[0], p.pos[1] + p.eye, p.pos[2]);
  camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
  camera.rotation.x += sh.y;
  camera.rotation.y += sh.x;
}

let hadLock = false;
function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hadLock = true;
    audio.unlock();
    document.getElementById('start').hidden = true;
    document.getElementById('matchend').hidden = true;
  } else if (store.phase !== PHASE.OVER) {
    if (started && hadLock) document.getElementById('start').hidden = false;
  }
}

window.__gameStart = () => {
  audio.unlock();
  document.getElementById('start').hidden = true;
  if (!started) { started = true; }
  input.requestLock();
};
window.__gameRestart = () => {
  location.reload();
};
window.__gameCloseBuy = () => { rounds.startLive(); };
window.__gameBuy = (kind) => {
  if (store.phase !== PHASE.BUY) return;
  let ok = false;
  if (kind === 'smg' || kind === 'awp') ok = armoury.buy(kind, store);
  else if (kind === 'armor' || kind === 'nade') ok = armoury.buy(kind, store);
  if (ok) { audio.click(); hud.refreshBuy(); }
};
// buy hotkeys 2..5 while the menu is open
window.addEventListener('keydown', (e) => {
  if (store.phase !== PHASE.BUY || store.buyOpen === false) return;
  if (e.code === 'Digit2') window.__gameBuy('smg');
  if (e.code === 'Digit3') window.__gameBuy('awp');
  if (e.code === 'Digit4') window.__gameBuy('armor');
  if (e.code === 'Digit5') window.__gameBuy('nade');
});

hud.setBuyOpen(false, 1);
rounds.startBuy(true);
if (shot) hud.setBuyOpen(false, 1);

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let n = 0;
    while (accumulator >= FIXED && n < 5) { step(FIXED); accumulator -= FIXED; n++; }
    if (accumulator > FIXED * 5) accumulator = 0;
    if (autoplay) autoplayTick(dt);
    syncCamera();
    fx.step(dt);
    hud.frame(bots, armoury.spreadOf(playerSpeed));
  }
  renderer.render(scene, camera);
}

// --- deterministic captures ---------------------------------------------
function settle(n) { for (let i = 0; i < n; i++) step(FIXED); }
function aimAt(x, y, z) {
  const p = store.player;
  const dx = x - p.pos[0], dy = y - (p.pos[1] + p.eye), dz = z - p.pos[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}
function forceBuy() {
  store.money = 9000;
  armoury.buy('awp', store);
  armoury.buy('armor', store);
  armoury.state.nades = 2;
  hud.refreshBuy();
}
function runWar() {
  // mid-round firefight: live phase, bots pushed toward the player, tracers out
  rounds.startLive();
  store.player.pos = [-3, 0, 6];
  store.player.yaw = 0.35; store.player.pitch = 0.02;
  for (const b of bots.items) {
    b.pos.set(-3 + (b.id - 1.5) * 2.2, 0, -6 - b.id * 1.5);
    b.mode = 'fight'; b.react = 0;
    b.root.visible = true;
  }
  settle(30);
  aimAt(-3, 1.2, -7);
  // our tracer volley
  for (let i = 0; i < 4; i++) {
    camera.getWorldDirection(camDir);
    scene.updateMatrixWorld(true);
    raycaster.set(camera.position, camDir);
    raycaster.far = 90;
    const hit = raycaster.intersectObjects(bots.hitMeshes, false)[0];
    tmpV.copy(camera.position).addScaledVector(camDir, 1.2);
    if (hit) { fx.tracer(tmpV, hit.point, false); fx.puff(hit.point, true); }
    settle(7);
  }
  // their reply tracers
  for (const b of bots.items.slice(0, 3)) {
    tmpV.set(b.pos.x, 1.45, b.pos.z);
    tmpV2.set(store.player.pos[0], store.player.pos[1] + 1.4, store.player.pos[2] + 0.4);
    fx.tracer(tmpV, tmpV2, true);
  }
  fx.puff(new THREE.Vector3(store.player.pos[0] - 1, 1.2, store.player.pos[2] - 3), false);
  settle(10);
}
function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    fx.step(1 / 60);
    hud.frame(bots, 0.004);
    renderer.render(scene, camera);
    painted++;
    if (painted === 2) { window.__shotReady = true; frozen = true; }
  }
  requestAnimationFrame(paint);
}
function runShot(name) {
  input.state.sim = true;
  if (name === 'start') {
    store.player.pos = [0, 0, 10.5];
    store.player.yaw = 0; store.player.pitch = 0.02;
    settle(25);
    syncCamera();
    document.getElementById('start').hidden = false;
    hud.frame(bots, 0.002);
  } else if (name === 'buy') {
    forceBuy();
    store.player.pos = [0, 0, 10.5];
    store.player.yaw = -0.2; store.player.pitch = 0.02;
    settle(25);
    syncCamera();
    hud.setBuyOpen(true, 2);
    hud.refreshBuy();
    hud.frame(bots, 0.002);
    document.getElementById('start').hidden = true;
  } else if (name === 'play' || name === 'war') {
    document.getElementById('start').hidden = true;
    runWar();
  } else { // end
    document.getElementById('start').hidden = true;
    rounds.startLive();
    store.player.pos = [10, 0, 3];
    store.player.yaw = -1.2; store.player.pitch = 0;
    store.bomb.state = 'ticking';
    store.bomb.site = 'B';
    store.bomb.pos = [SITES_POS.B.x, 0.35, SITES_POS.B.z];
    store.bomb.tickT = 22;
    world.charge.visible = true;
    world.charge.position.set(store.bomb.pos[0], 0.5, store.bomb.pos[2]);
    for (const b of bots.items.slice(0, 2)) {
      b.pos.set(11 + b.id, 0, -2 - b.id);
      b.mode = 'fight'; b.root.visible = true;
    }
    settle(25);
    aimAt(store.bomb.pos[0], 0.8, store.bomb.pos[2]);
    hud.showBanner(false, 'CHARGE TICKING', 'Defuse the charge on site B [E]', 600);
    hud.frame(bots, 0.003);
  }
  hud.frame(bots, 0.004);
  paintTwiceThenReady();
}

// --- autoplay bot for live capture: walks, aims, fires at nearest foe ----
let autoT = 0;
const autoKeys = new Set();
function autoplayTick(dt) {
  autoT += dt;
  input.state.sim = true;
  if (store.phase === PHASE.BUY && autoT > 1) { rounds.startLive(); }
  if (store.phase !== PHASE.LIVE || !store.player.alive) return;
  let best = null, bestD = 1e9;
  for (const b of bots.items) {
    if (!b.alive) continue;
    const d = Math.hypot(b.pos.x - store.player.pos[0], b.pos.z - store.player.pos[2]);
    if (d < bestD) { bestD = d; best = b; }
  }
  input.state.keys.clear();
  input.state.firing = false;
  if (best) {
    aimAt(best.pos.x, 1.25, best.pos.z);
    if (bestD > 7) input.state.keys.add('KeyW');
    if (autoT % 0.5 < 0.3) input.state.firing = true;
  }
  if (Math.floor(autoT * 2) % 20 === 0) input.state.keys.add('KeyA');
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
if (shot) { document.getElementById('start').hidden = true; runShot(shot); }
else requestAnimationFrame(frame);
if (autoplay && !shot) requestAnimationFrame(frame);
