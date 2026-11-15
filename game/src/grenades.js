// Spark grenades: press G once to arm, release pattern — here a single press
// throws after a 0.6 s fuse-style windup. Bouncing orb, radial damage with
// falloff and a wall check so cover matters.
import * as THREE from 'three';

const SPEED = 15;
const RADIUS = 6.5;
const MAX_DMG = 95;
const FUSE = 1.1;

export function createGrenades(scene, colliders, shootables) {
  const live = [];
  const geo = new THREE.SphereGeometry(0.11, 10, 8);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffc46b, emissive: 0xff7a1a, emissiveIntensity: 1.4 });
  const tmp = new THREE.Vector3();
  const segStart = new THREE.Vector3();
  const segDir = new THREE.Vector3();
  const ray = new THREE.Raycaster();

  function throwNade(from, dir) {
    if (live.length >= 3) return null;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from);
    scene.add(mesh);
    const n = { mesh, vel: dir.clone().multiplyScalar(SPEED).add(new THREE.Vector3(0, 3.4, 0)), fuse: FUSE };
    live.push(n);
    return n;
  }
  function blockedAt(x, y, z) {
    tmp.set(x, y, z);
    for (let i = 0; i < colliders.length; i++) {
      if (colliders[i].containsPoint(tmp)) return colliders[i];
    }
    return null;
  }
  function clearPath(a, b) {
    segDir.copy(b).sub(a);
    const len = segDir.length();
    if (len < 0.001) return true;
    segDir.multiplyScalar(1 / len);
    ray.set(a, segDir);
    ray.far = len;
    const hits = ray.intersectObjects(shootables, false);
    return hits.length === 0;
  }
  // returns [{kind:'bot',bot,amount}|{kind:'player',amount}]
  function explode(n, bots, playerPos, playerAlive) {
    const out = [];
    const c = n.mesh.position;
    for (const b of bots.foes) {
      if (!b.alive) continue;
      segStart.set(b.pos.x, 1.2, b.pos.z);
      const d = segStart.distanceTo(c);
      if (d > RADIUS) continue;
      if (!clearPath(c, segStart)) continue;
      const amount = MAX_DMG * (1 - (d / RADIUS) * 0.75);
      out.push({ kind: 'bot', bot: b, amount });
    }
    if (playerAlive) {
      segStart.set(playerPos.x, playerPos.y, playerPos.z);
      const d = segStart.distanceTo(c);
      if (d <= RADIUS && clearPath(c, segStart)) {
        out.push({ kind: 'player', amount: MAX_DMG * 0.55 * (1 - (d / RADIUS) * 0.7) });
      }
    }
    return out;
  }
  return {
    throwNade,
    count() { return live.length; },
    update(dt, bots, playerPos, playerAlive, onBoom) {
      for (let i = live.length - 1; i >= 0; i--) {
        const n = live[i];
        n.fuse -= dt;
        n.vel.y -= 16 * dt;
        const p = n.mesh.position;
        const nx = p.x + n.vel.x * dt, ny = p.y + n.vel.y * dt, nz = p.z + n.vel.z * dt;
        if (!blockedAt(nx, p.y, p.z)) p.x = nx; else n.vel.x *= -0.35;
        if (!blockedAt(p.x, ny, p.z)) p.y = ny; else { n.vel.y *= -0.4; n.vel.x *= 0.7; n.vel.z *= 0.7; }
        if (!blockedAt(p.x, p.y, nz)) p.z = nz; else n.vel.z *= -0.35;
        if (p.y < 0.11) { p.y = 0.11; n.vel.y = Math.abs(n.vel.y) * 0.4; n.vel.x *= 0.7; n.vel.z *= 0.7; }
        if (n.fuse <= 0) {
          scene.remove(n.mesh);
          n.mesh.geometry = geo; // shared, do not dispose
          live.splice(i, 1);
          onBoom(explode(n, bots, playerPos, playerAlive), p.clone());
        }
      }
    },
  };
}
