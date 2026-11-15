// Emberjackal raiders: capsule bodies with ember visors, torso + head hit
// zones, waypoint routes per site, hearing, vision cones, hold positions,
// plant orders, accuracy that decays with distance and target motion.
import * as THREE from 'three';
import { PALETTE, SITES } from './palette.js';
import { ROUTES } from './world.js';

const COUNT = 4;
const HP = 100;
const SPEED = 3.1;
const HOLD_SPEED = 1.4;
const SIGHT = 34;
const HEAR = 17;
const FOV = 0.62; // half-angle radians of the vision cone
const REACT = 0.42;
const BURST = 3;
const SHOT_GAP = 0.34;
const BURST_GAP = 1.15;
const BASE_HIT = 0.34;
const RESPAWN = 6;

const NAMES = ['RUST', 'SLAG', 'CINDER', 'SOOT'];
const SKINS = [0x7a4a2b, 0x5c5148, 0x6b3a3a, 0x44505c];

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function createBots(scene, colliders, store) {
  const group = new THREE.Group();
  scene.add(group);
  const bodyGeo = new THREE.CapsuleGeometry(0.34, 0.85, 4, 10);
  const headGeo = new THREE.SphereGeometry(0.2, 12, 10);
  const visorGeo = new THREE.BoxGeometry(0.3, 0.09, 0.06);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.62);
  const items = [];
  const hitMeshes = [];

  for (let i = 0; i < COUNT; i++) {
    const skin = new THREE.MeshStandardMaterial({ color: SKINS[i % SKINS.length], roughness: 0.75, metalness: 0.15 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x191420, roughness: 0.8 });
    const visor = new THREE.MeshStandardMaterial({ color: PALETTE.ember, emissive: PALETTE.ember, emissiveIntensity: 2.2 });
    const root = new THREE.Group();
    const torso = new THREE.Mesh(bodyGeo, skin);
    torso.position.y = 1.02;
    torso.castShadow = true;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeo, skin);
    head.position.y = 1.83;
    head.castShadow = true;
    head.userData.part = 'head';
    const vz = new THREE.Mesh(visorGeo, visor);
    vz.position.set(0, 1.85, 0.17);
    const gun = new THREE.Mesh(gunGeo, dark);
    gun.position.set(0.26, 1.25, 0.32);
    root.add(torso, head, vz, gun);
    root.visible = false;
    group.add(root);
    const item = {
      id: i, name: NAMES[i], root, torso, head, hp: HP, alive: false,
      pos: new THREE.Vector3(), yaw: 0, speed: 0,
      route: ROUTES.mid, wp: 0, mode: 'march', site: SITES.A,
      react: 0, burstLeft: 0, shotT: 0, burstT: 0, aimErr: 0,
      heardAt: null, holding: 0, respawnAt: 0, wanderT: 0, stride: 0,
    };
    torso.userData.bot = item;
    head.userData.bot = item;
    hitMeshes.push(torso, head);
    items.push(item);
  }

  function spawnRound(roundNum) {
    const pick = roundNum % 5;
    const lane = pick === 0 ? 'mid' : pick === 1 ? 'A' : pick === 2 ? 'B' : pick === 3 ? 'A' : 'mid';
    const site = lane === 'B' ? SITES.B : SITES.A;
    const route = ROUTES[lane];
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      const off = (i - 1.5) * 1.4;
      const r0 = route[0];
      b.pos.set(r0[0] + off, 0, r0[1] - i * 1.2);
      b.hp = HP; b.alive = true;
      b.route = route; b.wp = 0; b.mode = 'march'; b.site = site;
      b.react = 0; b.burstLeft = 0; b.shotT = 0; b.burstT = 0;
      b.heardAt = null; b.holding = 0; b.respawnAt = 0; b.wanderT = 0;
      b.root.visible = true;
      b.root.position.copy(b.pos);
    }
  }
  function alive() { return items.filter((b) => b.alive); }
  function canSee(b, targetPos, targetCrouch) {
    const dx = targetPos.x - b.pos.x;
    const dz = targetPos.z - b.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > SIGHT) return 0;
    const want = Math.atan2(-dx, -dz);
    const yawRef = b.mode === 'hold' || b.mode === 'fight' ? b.yaw : want;
    if (Math.abs(angleDiff(want, yawRef)) > FOV + 0.55 && dist > 4) return 0;
    const ty = targetPos.y - (targetCrouch ? 0.35 : 0);
    const dy = Math.abs(ty - 1.4);
    if (dy > 2.6 + dist * 0.12) return 0;
    return dist;
  }
  // horizontal capsule-vs-box resolve for bots (they stay on the ground)
  const probe = new THREE.Box3();
  function blocked(x, z) {
    probe.min.set(x - 0.34, 0.05, z - 0.34);
    probe.max.set(x + 0.34, 1.7, z + 0.34);
    for (let i = 0; i < colliders.length; i++) {
      if (probe.intersectsBox(colliders[i])) return true;
    }
    return false;
  }
  function moveToward(b, tx, tz, dt, sp) {
    const dx = tx - b.pos.x, dz = tz - b.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35) return true;
    b.yaw = Math.atan2(-dx, -dz);
    const stepLen = Math.min(d, sp * dt);
    const nx = b.pos.x + (dx / d) * stepLen;
    const nz = b.pos.z + (dz / d) * stepLen;
    if (!blocked(nx, nz)) { b.pos.x = nx; b.pos.z = nz; b.speed = sp; }
    else if (!blocked(nx, b.pos.z)) { b.pos.x = nx; b.speed = sp * 0.6; }
    else if (!blocked(b.pos.x, nz)) { b.pos.z = nz; b.speed = sp * 0.6; }
    else {
      // sidestep around the obstacle
      const sx = -dz / d, sz = dx / d;
      if (!blocked(b.pos.x + sx * stepLen, b.pos.z + sz * stepLen)) {
        b.pos.x += sx * stepLen; b.pos.z += sz * stepLen; b.speed = sp * 0.5;
      } else b.speed = 0;
    }
    return d < 0.9;
  }

  return {
    items, hitMeshes,
    spawnRound, alive,
    aliveCount() { let n = 0; for (const b of items) if (b.alive) n++; return n; },
    // events the caller drains: {type:'shot', bot, dist} {type:'killed', bot}
    events: [],
    damage(mesh, amount) {
      const b = mesh.userData.bot;
      if (!b || !b.alive) return false;
      b.hp -= amount;
      if (b.hp > 0) {
        b.react = Math.min(b.react, 0.12); // flinch: notice faster
        return false;
      }
      b.alive = false;
      b.root.visible = false;
      b.respawnAt = 0; // round-based: no mid-round respawn in live phase
      return true;
    },
    hear(x, z) {
      for (const b of items) {
        if (!b.alive) continue;
        const d = Math.hypot(x - b.pos.x, z - b.pos.z);
        if (d < HEAR) b.heardAt = { x, z };
      }
    },
    update(dt, time, playerPos, playerAlive, playerCrouch, playerSpeed, bombPlanted) {
      for (const b of items) {
        if (!b.alive) continue;
        b.stride += dt * (2 + b.speed * 1.6);
        // --- perception
        let dist = 0;
        if (playerAlive && store.phase === 'live') {
          dist = canSee(b, playerPos, playerCrouch);
          if (dist > 0) {
            if (b.react <= 0 && b.mode !== 'fight') { b.react = REACT; }
            b.mode = 'fight';
            b.lastSeenX = playerPos.x; b.lastSeenZ = playerPos.z;
          } else if (b.mode === 'fight') {
            b.loseT = (b.loseT || 0) + dt;
            if (b.loseT > 2.5) { b.mode = b.heardAt ? 'stalk' : 'march'; b.loseT = 0; }
          } else if (b.heardAt && b.mode === 'march') {
            b.mode = 'stalk';
          }
        }
        // --- behaviour
        if (b.react > 0) b.react -= dt;
        if (b.mode === 'fight' && dist > 0) {
          const want = Math.atan2(-(playerPos.x - b.pos.x), -(playerPos.z - b.pos.z));
          b.yaw += angleDiff(want, b.yaw) * Math.min(1, dt * 8);
          b.speed = 0;
        } else if (b.mode === 'stalk' && b.heardAt) {
          if (moveToward(b, b.heardAt.x, b.heardAt.z, dt, SPEED)) b.heardAt = null;
        } else if (b.mode === 'march' || b.mode === 'stalk') {
          const wp = b.route[Math.min(b.wp, b.route.length - 1)];
          const sp = bombPlanted ? HOLD_SPEED : SPEED;
          if (moveToward(b, wp[0], wp[1], dt, sp)) {
            b.wp++;
            if (b.wp >= b.route.length) {
              b.mode = 'hold';
              b.holding = 0;
              b.holdRoute = b.site === SITES.A ? ROUTES.holdA : ROUTES.holdB;
              b.holdIdx = Math.floor(Math.random() * 2);
            }
          }
        } else if (b.mode === 'hold') {
          b.holding += dt;
          const hp = b.holdRoute[b.holdIdx % b.holdRoute.length];
          if (moveToward(b, hp[0], hp[1], dt, HOLD_SPEED)) {
            b.holdIdx += (Math.random() < 0.002 ? 1 : 0);
            b.holding = 0;
          }
          // face the lane they came from
          const want = Math.atan2(b.route[0][0] - b.pos.x, -(b.route[0][1] - b.pos.z)) + Math.PI;
          void want;
        }
        // --- firing solution: bursts with distance falloff and motion penalty
        b.shotT -= dt; b.burstT -= dt;
        if (b.mode === 'fight' && b.react <= 0 && dist > 0 && dist < SIGHT) {
          if (b.burstLeft <= 0 && b.burstT <= 0) {
            b.burstLeft = BURST;
            b.burstT = BURST_GAP * (0.8 + Math.random() * 0.5);
            const movePenalty = Math.min(0.22, playerSpeed * 0.035);
            const crouchBonus = playerCrouch ? 0.06 : 0;
            b.aimErr = BASE_HIT * Math.max(0.12, 1 - dist / SIGHT) - movePenalty + crouchBonus;
            if (dist < 6) b.aimErr += 0.18;
          }
          if (b.burstLeft > 0 && b.shotT <= 0) {
            b.shotT = SHOT_GAP;
            b.burstLeft--;
            this.events.push({ type: 'shot', bot: b, dist, aimErr: b.aimErr });
          }
        }
        // --- pose
        b.root.position.set(b.pos.x, Math.abs(Math.sin(b.stride)) * 0.03 * Math.min(1, b.speed), b.pos.z);
        b.root.rotation.y = b.yaw;
      }
    },
  };
}
