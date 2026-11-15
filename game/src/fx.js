// Combat feedback: tracers, impact sparks, blood puffs, muzzle smoke bloom,
// explosion flash and screen shake. All pooled: zero allocation per frame.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACERS = 24;
const PUFFS = 40;
const SHAKE_DECAY = 7;

export function createFx(scene) {
  const tracerGeo = new THREE.BufferGeometry();
  const tracerPos = new Float32Array(TRACERS * 6);
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3));
  const tracerMat = new THREE.LineBasicMaterial({ color: PALETTE.ember, transparent: true, opacity: 0.9 });
  const tracers = new THREE.LineSegments(tracerGeo, tracerMat);
  tracers.frustumCulled = false;
  scene.add(tracers);
  const tracerLife = new Float32Array(TRACERS);
  let tracerIdx = 0;

  const puffGeo = new THREE.SphereGeometry(0.09, 6, 5);
  const puffMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9 });
  const bloodMat = new THREE.MeshBasicMaterial({ color: 0xc22418, transparent: true, opacity: 0.95 });
  const puffs = [];
  for (let i = 0; i < PUFFS; i++) {
    const m = new THREE.Mesh(puffGeo, puffMat);
    m.visible = false;
    scene.add(m);
    puffs.push({ mesh: m, life: 0, max: 1, vel: new THREE.Vector3() });
  }
  let puffIdx = 0;
  // explosion flash light, reused
  const boomLight = new THREE.PointLight(0xff7711, 0, 22);
  scene.add(boomLight);
  let boomT = 0;
  const shake = { x: 0, y: 0, amt: 0 };

  function tracer(a, b, foe) {
    const i = tracerIdx;
    tracerIdx = (tracerIdx + 1) % TRACERS;
    tracerPos[i * 6] = a.x; tracerPos[i * 6 + 1] = a.y; tracerPos[i * 6 + 2] = a.z;
    tracerPos[i * 6 + 3] = b.x; tracerPos[i * 6 + 4] = b.y; tracerPos[i * 6 + 5] = b.z;
    tracerGeo.attributes.position.needsUpdate = true;
    tracerLife[i] = foe ? 0.16 : 0.09;
  }
  function puff(p, blood) {
    const q = puffs[puffIdx];
    puffIdx = (puffIdx + 1) % PUFFS;
    q.mesh.visible = true;
    q.mesh.position.copy(p);
    q.mesh.material = blood ? bloodMat : puffMat;
    q.life = q.max = blood ? 0.5 : 0.3;
    q.vel.set((Math.random() - 0.5) * 2, Math.random() * 2.4, (Math.random() - 0.5) * 2);
    q.mesh.scale.setScalar(blood ? 1.4 : 1);
  }
  return {
    tracer, puff,
    boom(p) {
      boomLight.position.copy(p);
      boomLight.position.y += 1;
      boomT = 0.45;
      for (let k = 0; k < 10; k++) {
        puff({ x: p.x + (Math.random() - 0.5) * 2, y: p.y + Math.random(), z: p.z + (Math.random() - 0.5) * 2 }, false);
      }
    },
    shakeIt(amt) { shake.amt = Math.min(0.09, shake.amt + amt); },
    shakeOf() { return shake; },
    step(dt) {
      let any = false;
      for (let i = 0; i < TRACERS; i++) {
        if (tracerLife[i] > 0) {
          tracerLife[i] -= dt;
          any = true;
          if (tracerLife[i] <= 0) {
            for (let k = 0; k < 6; k++) tracerPos[i * 6 + k] = 0;
          }
        }
      }
      if (any) tracerGeo.attributes.position.needsUpdate = true;
      tracerMat.opacity = 0.9;
      for (const q of puffs) {
        if (q.life > 0) {
          q.life -= dt;
          q.mesh.position.addScaledVector(q.vel, dt);
          q.vel.y -= 4 * dt;
          const t = Math.max(0, q.life / q.max);
          q.mesh.material.opacity = t * 0.9;
          q.mesh.scale.setScalar(0.5 + (1 - t) * 1.6);
          if (q.life <= 0) q.mesh.visible = false;
        }
      }
      if (boomT > 0) {
        boomT -= dt;
        boomLight.intensity = Math.max(0, boomT * 260);
      } else boomLight.intensity = 0;
      if (shake.amt > 0.0005) {
        shake.amt *= Math.exp(-SHAKE_DECAY * dt);
        shake.x = (Math.random() - 0.5) * shake.amt;
        shake.y = (Math.random() - 0.5) * shake.amt;
      } else { shake.amt = 0; shake.x = 0; shake.y = 0; }
    },
  };
}
