// Player body: acceleration, friction, gravity, jump, crouch, axis-separated
// AABB collision so walls stop the body but never swallow it.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_H = 1.72, CROUCH_H = 1.12;
const STAND_EYE = 1.6, CROUCH_EYE = 1.02;
const WALK = 5.4, CROUCH = 2.5, AIR = 5.0;
const GROUND_ACCEL = 44, AIR_ACCEL = 10, FRICTION = 9.5;
const GRAVITY = 21, JUMP = 6.4;

export function createPlayer(colliders, store) {
  const p = store.player;
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();
  function overlaps(x, y, z, h, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + h - lift, z + RADIUS);
    for (let i = 0; i < colliders.length; i++) {
      if (probe.intersectsBox(colliders[i])) return colliders[i];
    }
    return null;
  }
  function look(dx, dy, sens) {
    p.yaw -= dx * (sens || 0.0022);
    p.pitch -= dy * (sens || 0.0022);
    if (p.pitch > 1.45) p.pitch = 1.45;
    else if (p.pitch < -1.45) p.pitch = -1.45;
  }
  function recoil(pk, yk) {
    p.pitch = Math.min(1.45, p.pitch + pk);
    p.yaw += yk;
  }
  function speed2d() { return Math.hypot(p.vel[0], p.vel[2]); }
  function step(dt, keys) {
    const crouchKey = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouchKey && !p.crouching) { p.crouching = true; }
    else if (!crouchKey && p.crouching && !overlaps(p.pos[0], p.pos[1], p.pos[2], STAND_H, 0.02)) {
      p.crouching = false;
    }
    const eyeT = p.crouching ? CROUCH_EYE : STAND_EYE;
    p.eye += (eyeT - p.eye) * Math.min(1, dt * 12);
    const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (f || s) {
      const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
      wish.set(-sin * f + cos * s, 0, -cos * f - sin * s).normalize();
    }
    const top = p.crouching ? CROUCH : (p.onGround ? WALK : AIR);
    const accel = p.onGround ? GROUND_ACCEL : AIR_ACCEL;
    const blend = Math.min(1, accel * dt / top);
    p.vel[0] += (wish.x * top - p.vel[0]) * blend;
    p.vel[2] += (wish.z * top - p.vel[2]) * blend;
    if (p.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      p.vel[0] *= damp; p.vel[2] *= damp;
    }
    if (keys.has('Space') && p.onGround) { p.vel[1] = JUMP; p.onGround = false; }
    p.vel[1] -= GRAVITY * dt;
    const h = p.crouching ? CROUCH_H : STAND_H;
    const nx = p.pos[0] + p.vel[0] * dt;
    if (!overlaps(nx, p.pos[1], p.pos[2], h, 0.04)) p.pos[0] = nx;
    else p.vel[0] = 0;
    const nz = p.pos[2] + p.vel[2] * dt;
    if (!overlaps(p.pos[0], p.pos[1], nz, h, 0.04)) p.pos[2] = nz;
    else p.vel[2] = 0;
    p.pos[1] += p.vel[1] * dt;
    p.onGround = false;
    const hit = overlaps(p.pos[0], p.pos[1], p.pos[2], h, 0);
    if (hit && p.vel[1] <= 0) { p.pos[1] = hit.max.y; p.vel[1] = 0; p.onGround = true; }
    else if (hit) { p.pos[1] = hit.min.y - h; p.vel[1] = 0; }
    if (p.pos[1] < 0) { p.pos[1] = 0; p.vel[1] = 0; p.onGround = true; }
    if (p.pos[1] > 6) { p.pos[1] = 6; p.vel[1] = Math.min(0, p.vel[1]); }
    if (p.vel[1] < -30) p.vel[1] = -30;
    // arena clamp
    if (p.pos[0] < -17.4) { p.pos[0] = -17.4; p.vel[0] = 0; }
    if (p.pos[0] > 17.4) { p.pos[0] = 17.4; p.vel[0] = 0; }
    if (p.pos[2] < -12.4) { p.pos[2] = -12.4; p.vel[2] = 0; }
    if (p.pos[2] > 12.4) { p.pos[2] = 12.4; p.vel[2] = 0; }
  }
  return { step, look, recoil, speed2d };
}
