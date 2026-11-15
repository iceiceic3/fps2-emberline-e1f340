// Emberline Foundry: an original dusk map. Two alloy vaults (A west, B east),
// three lanes between them, crates, pipes and a catwalk. Boxes are colliders
// and bullet stoppers; sightlines stay long down lanes, tight around corners.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const WALL_H = 5.2;
const HALF = 17;
// id, w,h,d, x, base-y, z, material-name
const BOXES = [
  // ground + outer walls
  ['g', 36, 0.5, 26, 0, -0.25, 0, 'ground'],
  ['wN', 36, WALL_H, 0.6, 0, WALL_H / 2, -13, 'sand'],
  ['wS', 36, WALL_H, 0.6, 0, WALL_H / 2, 13, 'sand'],
  ['wW', 0.6, WALL_H, 26, -18, WALL_H / 2, 0, 'sand'],
  ['wE', 0.6, WALL_H, 26, 18, WALL_H / 2, 0, 'sand'],
  // mid divider with two gates: long sightline down mid
  ['mid1', 1.2, 3.4, 6.5, 0, 1.7, -8.5, 'basalt'],
  ['mid2', 1.2, 3.4, 6.5, 0, 1.7, 8.5, 'basalt'],
  ['midTop', 1.2, 1.4, 7.0, 0, 3.9, 0, 'steel'],
  // site A (west vault): crates + arch
  ['aVault', 3.4, 2.6, 3.4, -13.5, 1.3, 0, 'rust'],
  ['aBox1', 1.6, 1.1, 1.6, -11.2, 0.55, -3.4, 'basalt'],
  ['aBox2', 1.6, 1.1, 1.6, -11.2, 0.55, 3.4, 'basalt'],
  ['aBox3', 1.2, 0.8, 1.2, -9.2, 0.4, 0, 'steel'],
  ['aArch1', 0.8, 4.2, 0.8, -9.0, 2.1, -2.2, 'sand'],
  ['aArch2', 0.8, 4.2, 0.8, -9.0, 2.1, 2.2, 'sand'],
  ['aLintel', 0.8, 0.8, 5.2, -9.0, 4.4, 0, 'sand'],
  // site B (east vault): pipes + stacked crates
  ['bVault', 3.4, 2.6, 3.4, 13.5, 1.3, 0, 'rust'],
  ['bPipe1', 1.1, 1.1, 7.0, 11.4, 0.55, -4.2, 'steel'],
  ['bPipe2', 1.1, 1.1, 7.0, 11.4, 0.55, 4.2, 'steel'],
  ['bBox1', 1.6, 1.1, 1.6, 10.6, 0.55, 0, 'basalt'],
  ['bBox2', 1.4, 0.9, 1.4, 10.6, 1.55, 0, 'steel'],
  // catwalk across mid (blocks movement under lintel? no: high above, no collider needed visually)
  ['walk', 6.0, 0.3, 1.8, 0, 4.0, 0, 'steel'],
  ['walkLeg1', 0.4, 4.0, 0.4, -2.8, 2.0, 0, 'rust'],
  ['walkLeg2', 0.4, 4.0, 0.4, 2.8, 2.0, 0, 'rust'],
  // lane crates: crouch cover, offset corners
  ['m1', 1.5, 1.05, 1.5, -4.2, 0.525, -5.6, 'basalt'],
  ['m2', 1.5, 1.05, 1.5, 4.2, 0.525, 5.6, 'basalt'],
  ['m3', 1.5, 1.05, 1.5, -4.2, 0.525, 5.6, 'basalt'],
  ['m4', 1.5, 1.05, 1.5, 4.2, 0.525, -5.6, 'basalt'],
  ['s1', 2.2, 0.8, 1.1, -6.5, 0.4, 10.2, 'basalt'],
  ['s2', 2.2, 0.8, 1.1, 6.5, 0.4, -10.2, 'basalt'],
  // spawn covers
  ['ct1', 2.4, 1.0, 1.2, -2.5, 0.5, 10.8, 'sand'],
  ['ct2', 2.4, 1.0, 1.2, 2.5, 0.5, 10.8, 'sand'],
  ['t1', 2.4, 1.0, 1.2, -2.5, 0.5, -10.8, 'sand'],
  ['t2', 2.4, 1.0, 1.2, 2.5, 0.5, -10.8, 'sand'],
];

export const SITES_POS = {
  A: new THREE.Vector3(-13.2, 0, 0),
  B: new THREE.Vector3(13.2, 0, 0),
};
// lanes the bots walk: T spawn -> mid/A/B -> site
export const ROUTES = {
  mid: [[-2, -10.5], [0, -4], [0, 3], [-2, 9.5]],
  A: [[-4, -10.5], [-5.5, -5], [-8.5, -1], [-11.5, 0]],
  B: [[4, -10.5], [5.5, -5], [8.5, -1], [11.5, 0]],
  holdA: [[-11.5, 2.5], [-11.5, -2.5]],
  holdB: [[11.5, 2.5], [11.5, -2.5]],
};

export function createWorld(scene) {
  const mats = {};
  for (const [name, hex] of Object.entries(PALETTE)) {
    if (typeof hex !== 'number') continue;
    mats[name] = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.9, metalness: 0.06 });
  }
  mats.sand.roughness = 0.95;
  mats.rust = new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.6, metalness: 0.45 });
  mats.steel = new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.45, metalness: 0.6 });

  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];
  const boxes = [];

  for (const [id, w, h, d, x, y, z, mname] of BOXES) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[mname]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.boxId = id;
    group.add(mesh);
    const bb = new THREE.Box3().setFromObject(mesh);
    colliders.push(bb);
    shootables.push(mesh);
    boxes.push({ id, mesh, bb });
  }

  // site beacons: glowing vault doors + floor rings
  const beacons = {};
  for (const site of ['A', 'B']) {
    const p = SITES_POS[site].clone();
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 2.0, 2.2),
      new THREE.MeshStandardMaterial({ color: PALETTE.ember, emissive: PALETTE.ember, emissiveIntensity: 1.6 }),
    );
    door.position.set(p.x + (site === 'A' ? 1.75 : -1.75), 1.4, p.z);
    group.add(door);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 1.9, 40),
      new THREE.MeshBasicMaterial({ color: PALETTE.ember, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, 0.02, p.z);
    group.add(ring);
    beacons[site] = { door, ring };
  }

  // planted charge mesh (hidden until planted)
  const charge = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.3, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xff2200, emissiveIntensity: 2 }),
  );
  charge.visible = false;
  charge.castShadow = true;
  scene.add(charge);

  // ember braziers: point lights along the lanes
  const braziers = [];
  const brazierPos = [[-6, -6.5], [6, 6.5], [-6, 6.5], [6, -6.5], [0, -11.5], [0, 11.5]];
  for (const [bx, bz] of brazierPos) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.1, 8), mats.rust);
    pole.position.set(bx, 0.55, bz);
    pole.castShadow = true;
    group.add(pole);
    const flame = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 10, 8),
      new THREE.MeshBasicMaterial({ color: PALETTE.ember }),
    );
    flame.position.set(bx, 1.25, bz);
    group.add(flame);
    const light = new THREE.PointLight(PALETTE.ember, 14, 11, 1.8);
    light.position.set(bx, 1.5, bz);
    scene.add(light);
    braziers.push({ flame, light, seed: bx * 3.1 + bz });
  }

  // sky: dusk gradient dome + one warm key light + cool fill
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.sky, 26, 70);
  const hemi = new THREE.HemisphereLight(0x8a6b9e, PALETTE.ground, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xff9a4d, 2.0);
  sun.position.set(-14, 18, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -24; sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24; sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0x4d6bff, 0.35);
  fill.position.set(12, 8, -10);
  scene.add(fill);

  return {
    colliders, shootables, group, beacons, charge, braziers, boxes,
    bounds: HALF,
    step(time) {
      for (const b of braziers) {
        const s = Math.sin(time * 9 + b.seed) * 0.5 + Math.sin(time * 23 + b.seed * 2) * 0.5;
        b.light.intensity = 14 + s * 3.5;
        const sc = 1 + s * 0.12;
        b.flame.scale.set(sc, sc * 1.3, sc);
      }
    },
  };
}
