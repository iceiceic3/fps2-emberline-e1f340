// Emberline squad AI: a real 5v5 team brain in one file, no black boxes.
//
// FOE raiders (5) attack the vaults in roles; YOU sentinels (4, plus the
// player as fifth) defend them. One shared blackboard carries contact calls,
// plant calls and deaths, so the round plays like team tactics:
//   IDLE    - buy phase, bots off the map
//   PUSH    - attackers walk their lane toward the called site
//   EXECUTE - attackers converge on the site ring together, entry first
//   HOLD    - defenders anchor a post; attackers guard a planted charge
//   (holding anchors skirmish from the post instead of chasing far contacts)
//   ROTATE  - a defender answers a teammate's contact call at the far site
//   RETAKE  - defenders sweep the planted site as a group
//   FIGHT   - overrides everything while an enemy is in the vision cone
//
// Roles decide the route and the job in the execute: ENTRY x2 walks point,
// SUPPORT x2 trades every death (one carries the charge), LURK x1 takes the
// opposite lane late and punishes rotators. ANCHOR x2 holds a vault each,
// ROVER x1 works mid, FLEX x1 plays off the rover's contact calls.
import * as THREE from 'three';
import { PALETTE, SITES } from './palette.js';
import { ROUTES } from './world.js';

const FOE_COUNT = 5;
const ALLY_COUNT = 4;
const HP = 100;
const PUSH_SPEED = 3.1;
const EXEC_SPEED = 3.4;
const ALERT_SPEED = 3.6;
const HOLD_SPEED = 1.4;
const SIGHT = 34;
const HEAR = 17;
const FOV = 0.62; // half-angle radians of the vision cone
const REACT = 0.42;
const COMMIT_RANGE = 12; // firefights commit up close; beyond this both sides
// share the contact and skirmish on the move, so executes keep flowing
const BURST = 3;
const SHOT_GAP = 0.34;
const BURST_GAP = 1.15;
const MOVE_PENALTY = 0.16; // firing on the move is ragged: discipline is the tell
const RESPITE = 2.5; // seconds before a lost contact drops back to plan
const TRADE_RANGE = 20;
const TRADE_BONUS = 0.09;
const PLANT_NEED = 3;
const PLANT_SIGHT = 14; // a watched carrier cannot stick the plant

const FOES = [
  { name: 'RUST', role: 'ENTRY', skin: 0x7a4a2b },
  { name: 'SLAG', role: 'ENTRY', skin: 0x5c5148 },
  { name: 'CINDER', role: 'SUPPORT', skin: 0x6b3a3a },
  { name: 'ASH', role: 'SUPPORT', skin: 0x44505c },
  { name: 'SOOT', role: 'LURK', skin: 0x4a3b2e },
];
const ALLIES = [
  { name: 'HALO', role: 'ANCHOR', skin: 0x3a4a5c },
  { name: 'IRON', role: 'ANCHOR', skin: 0x2e4a4e },
  { name: 'VEX', role: 'ROVER', skin: 0x3c3a5c },
  { name: 'JUNO', role: 'FLEX', skin: 0x2c4a44 },
];
// execute ring: five slots around each vault, entry takes slot 0
const RING = {
  A: [[-10.4, 0], [-12.2, 2.9], [-12.2, -2.9], [-9.2, 1.6], [-9.2, -1.6]],
  B: [[10.4, -2.2], [11.4, 2.9], [11.4, -2.9], [9.2, 1.6], [9.2, -1.6]],
};
const POST = {
  // defender anchors: [post x, post z, face x, face z] — every post verified
  // clear of colliders (a 0.34 probe must fit): IRON/JUNO used to spawn
  // inside a pipe and the mid wall and never moved a metre
  HALO: [-11.3, 5.4, -11.5, -8],
  IRON: [9.2, 1.6, 11.5, -4],
  VEX: [0, 2.2, 0, -10],
  JUNO: [2.2, 7.4, 0, -10],
  supportA: [-8, 4.2, -11.5, -4],
  supportB: [8.2, 1.4, 11.5, -4],
};
// CT-side patrol: off the walls, out of the mid crossfire
const ROVER_PATROL = [[-2.8, 7.2], [2.8, 7.2], [-2.8, 4.0]];
const ROLE_AIM = { ENTRY: 0.48, SUPPORT: 0.44, LURK: 0.42, ANCHOR: 0.30, ROVER: 0.29, FLEX: 0.29 };

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function siteOf(x) { return x < 0 ? SITES.A : SITES.B; }

export function createBots(scene, colliders, store) {
  const group = new THREE.Group();
  scene.add(group);
  const bodyGeo = new THREE.CapsuleGeometry(0.34, 0.85, 4, 10);
  const headGeo = new THREE.SphereGeometry(0.2, 12, 10);
  const visorGeo = new THREE.BoxGeometry(0.3, 0.09, 0.06);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.62);
  const items = [];
  const hitMeshes = []; // foe meshes only: the only legal target of the player

  let clock = 0; // game-elapsed clock: every contact call shares it
  // one shared blackboard: contact calls, the plant call, the team plan
  const comms = {
    foe: { contact: null, plan: SITES.A },
    you: { contact: null },
    plant: null, // {site, x, z} once the charge is down
  };

  function makeBot(def, team, visorColor) {
    const skin = new THREE.MeshStandardMaterial({ color: def.skin, roughness: 0.75, metalness: 0.15 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x191420, roughness: 0.8 });
    const visor = new THREE.MeshStandardMaterial({ color: visorColor, emissive: visorColor, emissiveIntensity: 2.2 });
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
    vz.position.set(0, 1.85, team === 'foe' ? 0.17 : -0.17);
    const gun = new THREE.Mesh(gunGeo, dark);
    gun.position.set(0.26, 1.25, 0.32);
    root.add(torso, head, vz, gun);
    root.visible = false;
    group.add(root);
    const b = {
      id: items.length, name: def.name, role: def.role, team,
      root, torso, head, hp: HP, alive: false,
      pos: new THREE.Vector3(), yaw: 0, speed: 0,
      route: ROUTES.mid, wp: 0, mode: 'IDLE', site: SITES.A,
      react: 0, burstLeft: 0, shotT: 0, burstT: 0, aimErr: 0.3,
      heardAt: null, contactAt: 0, veng: 0, vengX: 0, vengZ: 0,
      plantT: 0, ringSlot: 0, patrolIdx: 0, patrolT: 0, rotateT: 0, hadContact: false,
      lastSeenX: 0, lastSeenZ: 0, loseT: 0, stride: 0,
    };
    torso.userData.bot = b;
    head.userData.bot = b;
    if (team === 'foe') hitMeshes.push(torso, head);
    items.push(b);
    return b;
  }
  const foes = FOES.map((d) => makeBot(d, 'foe', PALETTE.ember));
  const allies = ALLIES.map((d, i) => makeBot(d, 'you', PALETTE.teal));

  function spawnRound(roundNum) {
    // the team plan: lean on the site the defenders left alone last round,
    // with a fixed rotation so every game shows both executes
    const plan = [SITES.A, SITES.B, SITES.A, SITES.B, SITES.A][roundNum % 5];
    comms.foe.plan = plan;
    comms.plant = null;
    comms.foe.contact = null;
    comms.you.contact = null;
    const mainLane = plan === SITES.A ? 'A' : 'B';
    const otherLane = plan === SITES.A ? 'B' : 'A';
    const main = ROUTES[mainLane];
    const other = ROUTES[otherLane];
    foes.forEach((b, i) => {
      // entries + supports hit the called site, the lurk walks the far lane
      b.route = b.role === 'LURK' ? other : main;
      b.site = b.role === 'LURK' ? siteOf(other[other.length - 1][0]) : plan;
      const r1 = b.route[1]; // stage past spawn cover, beside the route not on it
      const side = r1[0] >= 0 ? 1 : -1;
      b.pos.set(r1[0] + side * (0.9 + (i % 2) * 0.9), 0, r1[1] - 1.2 - Math.floor(i / 2) * 1.1);
      b.hp = HP; b.alive = true;
      b.wp = 1; b.mode = 'PUSH';
      b.react = 0; b.burstLeft = 0; b.shotT = 0; b.burstT = 0;
      b.heardAt = null; b.veng = 0; b.plantT = 0;
      b.ringSlot = i;
      b.loseT = 0; b.contactX = 0; b.contactZ = 0; b.hadContact = false;
      b.fightKind = null; b.fightRef = null;
      b.lastSeenX = 0; b.lastSeenZ = 0;
      b.root.visible = true;
      b.root.position.copy(b.pos);
    });
    allies.forEach((b, ai) => {
      b.hp = HP; b.alive = true;
      b.ringSlot = ai;
      b.mode = 'HOLD'; b.patrolIdx = 0; b.patrolT = 0; b.rotateT = 0;
      b.react = 0; b.burstLeft = 0; b.shotT = 0; b.burstT = 0;
      b.heardAt = null; b.veng = 0; b.loseT = 0; b.hadContact = false;
      b.fightKind = null; b.fightRef = null;
      const pk = POST[b.name];
      b.pos.set(pk[0], 0, pk[1]);
      b.yaw = Math.atan2(-(pk[2] - pk[0]), -(pk[3] - pk[1]));
      b.root.visible = true;
      b.root.position.copy(b.pos);
      b.root.rotation.y = b.yaw;
    });
  }
  function aliveFoes() { return foes.filter((b) => b.alive); }
  function aliveAllies() { return allies.filter((b) => b.alive); }

  function canSee(b, tx, ty, tz) {
    const dx = tx - b.pos.x;
    const dz = tz - b.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > SIGHT) return 0;
    const want = Math.atan2(-dx, -dz);
    // attackers walk face-first down their lane: they engage whatever stands
    // ahead of the advance, even without a FIGHT lock
    const onRoute = b.team === 'foe' && (b.mode === 'PUSH' || b.mode === 'EXECUTE');
    const yawRef = (b.mode === 'HOLD' || b.mode === 'FIGHT' || onRoute) ? b.yaw : want;
    if (Math.abs(angleDiff(want, yawRef)) > FOV + 0.55 && dist > 4) return 0;
    if (Math.abs(ty - 1.4) > 2.6 + dist * 0.12) return 0;
    if (dist > 3 && !losClear(b.pos.x, b.pos.z, tx, tz)) return 0;
    return dist;
  }
  // horizontal capsule-vs-box resolve so bots slide along cover, never inside
  const probe = new THREE.Box3();
  function blocked(x, z) {
    probe.min.set(x - 0.34, 0.05, z - 0.34);
    probe.max.set(x + 0.34, 1.7, z + 0.34);
    for (let i = 0; i < colliders.length; i++) {
      if (probe.intersectsBox(colliders[i])) return true;
    }
    return false;
  }
  // line of sight: walls and cover block vision (axis-stepped segment test)
  function losClear(x0, z0, x1, z1) {
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.8));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (blocked(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
    }
    return true;
  }
  // straight-line probe: is the whole walk to the goal clear of walls?
  function pathClear(x0, z0, x1, z1) {
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.9));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (blocked(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
    }
    return true;
  }
  // corners the lane routes bend around: bots detour when the direct walk is blocked
  const CORNERS = [[-5.5, -5], [-8.5, -1], [5.5, -5], [8.5, -1], [0, -4], [0, 3]];
  function moveToward(b, tx, tz, dt, sp, via) {
    let gx = tx, gz = tz; // goal may detour through one waypoint corner
    if (via && !pathClear(b.pos.x, b.pos.z, tx, tz)) {
      let best = null, bestD = 1e9;
      for (const w of via) {
        if (!pathClear(b.pos.x, b.pos.z, w[0], w[1])) continue;
        if (!pathClear(w[0], w[1], tx, tz)) continue;
        const d = Math.hypot(w[0] - b.pos.x, w[1] - b.pos.z);
        if (d < bestD) { bestD = d; best = w; }
      }
      if (best) { gx = best[0]; gz = best[1]; }
      else if (b.route && b.wp < b.route.length) {
        // no corner sees both ends: fall back onto the hand-walked route
        const wpi = Math.min(b.wp, b.route.length - 1);
        gx = b.route[wpi][0]; gz = b.route[wpi][1];
      }
    }
    const dx = gx - b.pos.x, dz = gz - b.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.9) return gx === tx && gz === tz;
    b.yaw = Math.atan2(-dx, -dz);
    const stepLen = Math.min(d, sp * dt);
    const nx = b.pos.x + (dx / d) * stepLen;
    const nz = b.pos.z + (dz / d) * stepLen;
    if (!blocked(nx, nz)) { b.pos.x = nx; b.pos.z = nz; b.speed = sp; }
    else if (!blocked(nx, b.pos.z)) { b.pos.x = nx; b.speed = sp * 0.6; }
    else if (!blocked(b.pos.x, nz)) { b.pos.z = nz; b.speed = sp * 0.6; }
    else {
      const sx = -dz / d, sz = dx / d; // sidestep around the obstacle
      if (!blocked(b.pos.x + sx * stepLen, b.pos.z + sz * stepLen)) {
        b.pos.x += sx * stepLen; b.pos.z += sz * stepLen; b.speed = sp * 0.5;
      } else b.speed = 0;
    }
    return d < 0.9 && gx === tx && gz === tz;
  }
  function face(b, tx, tz, dt) {
    const want = Math.atan2(-(tx - b.pos.x), -(tz - b.pos.z));
    b.yaw += angleDiff(want, b.yaw) * Math.min(1, dt * 8);
  }

  return {
    items, foes, allies, hitMeshes, comms,
    spawnRound,
    alive: aliveFoes,
    allyList: aliveAllies,
    aliveCount() { let n = 0; for (const b of foes) if (b.alive) n++; return n; },
    allyCount() { let n = 0; for (const b of allies) if (b.alive) n++; return n; },
    // events the caller drains: {type:'shot',...} {type:'plant',...}
    events: [],
    damage(mesh, amount, kx, kz) {
      const b = mesh.userData.bot;
      if (!b || !b.alive) return false;
      b.hp -= amount;
      if (b.hp > 0) {
        b.react = Math.min(b.react, 0.12); // flinch: notice faster
        return false;
      }
      b.alive = false;
      b.root.visible = false;
      // TRADE: nearby teammates instantly punish the killer's position
      for (const t of items) {
        if (!t.alive || t.team !== b.team) continue;
        if (Math.hypot(t.pos.x - b.pos.x, t.pos.z - b.pos.z) > TRADE_RANGE) continue;
        t.veng = 6; t.vengX = kx; t.vengZ = kz; t.react = 0;
      }
      const side = b.team === 'foe' ? comms.you : comms.foe;
      side.contact = { x: kx, z: kz, time: -1 }; // death scream: timeless call
      return true;
    },
    // noise alerts the OTHER team: footsteps, shots, the knife, the charge
    noise(x, z, byTeam) {
      const side = byTeam === 'foe' ? comms.you : comms.foe;
      const heard = { x, z, time: clock };
      side.contact = heard;
      for (const b of items) {
        if (!b.alive || b.team === byTeam) continue;
        if (Math.hypot(x - b.pos.x, z - b.pos.z) < HEAR) b.heardAt = heard;
      }
    },
    hear(x, z) { // the player's own noise: alerts the raiders only
      this.noise(x, z, 'you');
    },
    enemiesOf(b, playerPos, playerAlive) {
      // flat list the perception pass scans: [x, y, z, kind, ref]
      const out = [];
      if (b.team === 'foe') {
        if (playerAlive && store.phase === 'live') {
          out.push([playerPos.x, playerPos.y, playerPos.z, 'player', null]);
        }
        for (const a of allies) {
          if (a.alive) out.push([a.pos.x, 1.2, a.pos.z, 'ally', a]);
        }
      } else {
        for (const f of foes) {
          if (f.alive) out.push([f.pos.x, 1.2, f.pos.z, 'foe', f]);
        }
      }
      return out;
    },
    update(dt, time, playerPos, playerAlive, playerCrouch, playerSpeed, bombPlanted) {
      clock = time;
      const planted = comms.plant;
      for (const b of items) {
        if (!b.alive) continue;
        b.stride += dt * (2 + b.speed * 1.6);
        // --- perception: nearest visible enemy wins; vengeance pre-aims ---
        let dist = 0, kind = null, ref = null;
        if (store.phase === 'live') {
          const foesList = this.enemiesOf(b, playerPos, playerAlive);
          let best = 1e9;
          for (let i = 0; i < foesList.length; i++) {
            const e = foesList[i];
            const d = canSee(b, e[0], e[1], e[2]);
            if (d > 0 && d < best) { best = d; dist = d; kind = e[3]; ref = e[4]; }
          }
          if (dist > 0) {
            // PUSH and ROTATE never freeze at range: both share the contact,
            // keep walking the plan, and skirmish on the move at a ragged
            // penalty. Only contact inside COMMIT_RANGE pins a bot into FIGHT;
            // attackers never stop for a far contact at all — the entries lead
            // and the line walks the lane behind them.
            const advancing = (b.mode === 'PUSH' || b.mode === 'ROTATE')
              && (b.team === 'foe' || dist > COMMIT_RANGE);
            if (!b.hadContact) { b.react = b.veng > 0 ? 0 : REACT; b.hadContact = true; }
            b.fightKind = kind; b.fightRef = ref;
            b.lastSeenX = kind === 'player' ? playerPos.x : ref.pos.x;
            b.lastSeenZ = kind === 'player' ? playerPos.z : ref.pos.z;
            b.loseT = 0;
            // share the contact: the whole team rotates on one call
            const side = b.team === 'foe' ? comms.foe : comms.you;
            side.contact = { x: b.lastSeenX, z: b.lastSeenZ, time: time };
            if (!advancing) {
              if (b.team === 'you' && b.mode !== 'ROTATE' && dist > COMMIT_RANGE) {
                b.mode = 'HOLD'; // anchor discipline: fight from the post, not the open
              } else b.mode = 'FIGHT';
            }
          } else {
            b.hadContact = false;
            if (b.mode === 'FIGHT') {
              b.loseT += dt;
              if (b.loseT > RESPITE) {
                b.loseT = 0;
                b.mode = b.team === 'foe'
                  ? (bombPlanted || planted ? 'HOLD' : 'EXECUTE')
                  : (planted ? 'RETAKE' : 'HOLD');
              }
            } else if (b.heardAt && (b.mode === 'PUSH' || b.mode === 'HOLD')) {
              b.mode = b.team === 'foe' ? 'EXECUTE' : 'ROTATE';
              b.rotateT = 8;
              b.contactX = b.heardAt.x; b.contactZ = b.heardAt.z;
              if (b.team === 'you') b.heardAt = null;
            }
          }
        }
        if (b.react > 0) b.react -= dt;
        if (b.veng > 0) b.veng -= dt;
        // --- team behaviour ---
        if (b.mode === 'FIGHT' && dist > 0) {
          face(b, b.lastSeenX, b.lastSeenZ, dt);
          b.speed = 0;
        } else if (b.team === 'foe') {
          this.updateFoe(b, dt, planted, bombPlanted);
        } else {
          this.updateAlly(b, dt, planted, time);
        }
        // --- firing solution: bursts, distance falloff, motion penalty ---
        // no wall-eyes: the lane must be genuinely clear at trigger pull
        b.shotT -= dt; b.burstT -= dt;
        if ((b.mode === 'FIGHT' || (b.hadContact && (b.mode === 'PUSH' || b.mode === 'ROTATE' || b.mode === 'EXECUTE'))) && b.react <= 0 && dist > 0 && dist < SIGHT
          && losClear(b.pos.x, b.pos.z, b.lastSeenX, b.lastSeenZ)) {
          if (b.burstLeft <= 0 && b.burstT <= 0) {
            b.burstLeft = BURST;
            b.burstT = BURST_GAP * (0.8 + Math.random() * 0.5);
            // fire on the move is ragged, standing is clean: the discipline tell
            const movePenalty = b.mode === 'FIGHT' ? 0 : MOVE_PENALTY;
            const crouchBonus = (b.fightKind === 'player' && playerCrouch) ? 0.06 : 0;
            const vengBonus = b.veng > 0 ? TRADE_BONUS : 0;
            b.aimErr = ROLE_AIM[b.role] * Math.max(0.12, 1 - dist / SIGHT)
              - movePenalty + crouchBonus - vengBonus;
            if (dist < 6) b.aimErr += 0.18;
          }
          if (b.burstLeft > 0 && b.shotT <= 0) {
            b.shotT = SHOT_GAP;
            b.burstLeft--;
            this.events.push({
              type: 'shot', bot: b, dist, aimErr: b.aimErr,
              kind: b.fightKind, ref: b.fightRef,
              tx: b.lastSeenX, tz: b.lastSeenZ,
            });
          }
        }
        // --- pose ---
        b.root.position.set(b.pos.x, Math.abs(Math.sin(b.stride)) * 0.03 * Math.min(1, b.speed), b.pos.z);
        b.root.rotation.y = b.yaw;
      }
    },
    updateFoe(b, dt, planted, bombPlanted) {
      const ring = RING[b.site];
      if (planted || bombPlanted) {
        // charge down: converge the ring and guard it, entry closest in
        const slot = ring[b.ringSlot % ring.length];
        moveToward(b, slot[0], slot[1], dt, b.mode === 'FIGHT' ? 0 : HOLD_SPEED, CORNERS);
        b.mode = b.mode === 'FIGHT' ? 'FIGHT' : 'HOLD';
        return;
      }
      if (b.mode === 'PUSH') {
        const wp = b.route[Math.min(b.wp, b.route.length - 1)];
        if (moveToward(b, wp[0], wp[1], dt, PUSH_SPEED, CORNERS)) {
          b.wp++;
          if (b.wp >= b.route.length) { b.mode = 'EXECUTE'; }
        }
      } else if (b.mode === 'EXECUTE') {
        const slot = ring[b.ringSlot % ring.length];
        const laneEnd = b.route[b.route.length - 1];
        const laneX = laneEnd ? laneEnd[0] : slot[0];
        const laneZ = laneEnd ? laneEnd[1] : slot[1];
        const nearLane = Math.hypot(b.pos.x - laneX, b.pos.z - laneZ) < 5.0;
        const nearSlot = Math.hypot(b.pos.x - slot[0], b.pos.z - slot[1]);
        if (b.role !== 'SUPPORT' && (b.role === 'ENTRY' || nearLane || nearSlot < 14 || b.wp >= b.route.length)) {
          // entries (and anyone at the mouth or near the ring) collapse
          // straight onto the slot — never loop back toward spawn waypoints
          if (moveToward(b, slot[0], slot[1], dt, EXEC_SPEED, CORNERS)) b.wp = b.route.length;
        } else {
          // supports short of the mouth: finish the lane FORWARD along the
          // route, never backwards — then fight around the ring contact
          const wpi = Math.min(b.wp, b.route.length - 1);
          const wp = b.route[wpi];
          if (moveToward(b, wp[0], wp[1], dt, EXEC_SPEED, CORNERS)) b.wp++;
          else if (b.wp < b.route.length - 1) b.wp++; // nudge past a stuck node
        }
        // the carrier sticks the plant when the site is unwatched
        if ((b.role === 'SUPPORT') && this.isCarrier(b)) {
          const c = b.site === SITES.A ? [-13.2, 0] : [13.2, 0];
          if (Math.hypot(b.pos.x - c[0], b.pos.z - c[1]) < 2.4) {
            let watched = false;
            for (const a of allies) {
              if (!a.alive) continue;
              if (Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) > PLANT_SIGHT) continue;
              watched = true; break;
            }
            if (!watched) {
              b.plantT += dt;
              b.speed = 0;
              if (b.plantT >= PLANT_NEED) {
                b.plantT = 0;
                this.events.push({ type: 'plant', site: b.site, x: c[0], z: c[1] });
              }
            } else b.plantT = Math.max(0, b.plantT - dt);
          }
        }
      } else if (b.mode === 'HOLD') {
        const slot = ring[b.ringSlot % ring.length];
        moveToward(b, slot[0], slot[1], dt, HOLD_SPEED, CORNERS);
      }
    },
    isCarrier(b) {
      // first living support owns the charge; the next inherits on death
      for (const f of foes) {
        if (f.alive && f.role === 'SUPPORT') return f === b;
      }
      return false;
    },
    updateAlly(b, dt, planted, time) {
      if (planted) {
        // RETAKE: sweep the planted ring together, flex closest in
        const ring = RING[planted.site];
        const slot = ring[(b.ringSlot + 2) % ring.length];
        moveToward(b, slot[0], slot[1], dt, ALERT_SPEED, CORNERS);
        b.mode = b.mode === 'FIGHT' ? 'FIGHT' : 'RETAKE';
        return;
      }
      if (b.mode === 'RETAKE' || b.mode === 'ROTATE') {
        b.rotateT -= dt;
        const done = moveToward(b, b.contactX, b.contactZ, dt, ALERT_SPEED, CORNERS);
        if (done || b.rotateT <= 0) {
          b.mode = 'HOLD';
          const pk = POST[b.name];
          if (pk) { b.contactX = pk[0]; b.contactZ = pk[1]; }
        }
        if (b.mode !== 'FIGHT' && (done || b.rotateT <= 0)) b.mode = 'HOLD';
        return;
      }
      if (b.role === 'ROVER') {
        b.patrolT += dt;
        const wp = ROVER_PATROL[b.patrolIdx % ROVER_PATROL.length];
        if (moveToward(b, wp[0], wp[1], dt, HOLD_SPEED, CORNERS) || b.patrolT > 7) {
          b.patrolIdx++; b.patrolT = 0;
        }
        return;
      }
      // anchors + flex hold their post and face the lane they came from
      const pk = POST[b.name] || POST.JUNO;
      const arrived = Math.hypot(b.pos.x - pk[0], b.pos.z - pk[1]) < 0.6;
      if (!arrived && b.mode === 'HOLD') {
        moveToward(b, pk[0], pk[1], dt, HOLD_SPEED, CORNERS);
      } else {
        b.speed = 0;
        const want = Math.atan2(-(pk[2] - b.pos.x), -(pk[3] - b.pos.z));
        b.yaw += angleDiff(want, b.yaw) * Math.min(1, dt * 4);
      }
      // flex answers fresh contact calls at the far site (death screams count)
      if (b.role === 'FLEX' && b.mode === 'HOLD') {
        const c = comms.you.contact;
        const fresh = c && (c.time < 0 || (c.time > 0 && time - c.time < 6));
        if (fresh && siteOf(c.x) !== siteOf(b.pos.x)) {
          const sup = siteOf(c.x) === SITES.A ? POST.supportA : POST.supportB;
          b.contactX = sup[0]; b.contactZ = sup[1];
          b.mode = 'ROTATE'; b.rotateT = 8;
        }
      }
    },
  };
}
