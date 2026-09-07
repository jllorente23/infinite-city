import * as THREE from 'three';
import { createAssets } from './textures';
import { kitBody, kitWheel, usesTruckWheel } from './carModels';

/**
 * Cars are extruded side profiles, not stacked boxes: the silhouette carries the
 * hood, windscreen rake, roof curve and real wheel arches, and the bevel rounds
 * every edge. Swap any of these for a glTF later (see public/models/README.md).
 */

export type VehicleKind = 'sedan' | 'suv' | 'pickup' | 'van' | 'bus' | 'taxi' | 'police' | 'ambulance' | 'jeep';

type Spec = {
  L: number; W: number; wr: number; bottom: number;
  arches: { x: number; r: number }[];
  top: number[][];
  glass: number[][] | null;
};

export const SPEC: Record<string, Spec> = {
  sedan: {
    L: 4.5, W: 1.86, wr: 0.34, bottom: 0.26,
    arches: [{ x: 1.02, r: 0.52 }, { x: 3.48, r: 0.52 }],
    top: [[4.46, 0.62, 4.42, 0.78], [3.62, 0.84], [3.0, 1.3, 2.6, 1.32], [1.9, 1.32], [1.5, 1.28, 1.32, 0.86], [0.42, 0.78], [0.06, 0.72, 0.03, 0.5]],
    glass: [[3.44, 0.86], [2.96, 1.26], [1.98, 1.28], [1.42, 0.9]]
  },
  suv: {
    L: 4.75, W: 1.96, wr: 0.4, bottom: 0.34,
    arches: [{ x: 1.1, r: 0.58 }, { x: 3.62, r: 0.58 }],
    top: [[4.72, 0.7, 4.7, 1.55], [4.3, 1.62], [3.9, 1.66, 3.5, 1.68], [1.7, 1.68], [1.44, 1.66, 1.3, 1.0], [0.5, 0.92], [0.08, 0.86, 0.04, 0.6]],
    glass: [[4.24, 0.96], [4.2, 1.56], [1.62, 1.6], [1.4, 1.0]]
  },
  pickup: {
    L: 5.2, W: 1.98, wr: 0.42, bottom: 0.38,
    arches: [{ x: 1.15, r: 0.6 }, { x: 4.0, r: 0.6 }],
    top: [[5.16, 0.74, 5.12, 1.18], [2.9, 1.16], [2.86, 1.7], [2.5, 1.72, 2.1, 1.72], [1.6, 1.7, 1.42, 1.02], [0.5, 0.96], [0.06, 0.9, 0.03, 0.62]],
    glass: [[2.82, 1.12], [2.8, 1.66], [1.72, 1.66], [1.5, 1.08]]
  },
  van: {
    L: 5.3, W: 2.02, wr: 0.4, bottom: 0.36,
    arches: [{ x: 1.2, r: 0.58 }, { x: 4.2, r: 0.58 }],
    top: [[5.28, 0.8, 5.26, 2.24], [1.5, 2.28], [1.2, 2.26, 0.85, 1.4], [0.3, 1.05], [0.06, 0.92, 0.03, 0.62]],
    glass: [[1.42, 1.24], [1.36, 2.18], [0.98, 2.16], [0.72, 1.32]]
  },
  bus: {
    L: 9.6, W: 2.5, wr: 0.55, bottom: 0.5,
    arches: [{ x: 1.9, r: 0.75 }, { x: 7.4, r: 0.75 }],
    top: [[9.58, 1.0, 9.56, 3.0], [0.4, 3.04], [0.06, 3.0, 0.04, 1.1]],
    glass: [[9.3, 1.6], [9.28, 2.7], [0.4, 2.72], [0.38, 1.6]]
  },
  jeep: {
    L: 4.3, W: 1.98, wr: 0.5, bottom: 0.46,
    arches: [{ x: 1.05, r: 0.68 }, { x: 3.3, r: 0.68 }],
    top: [[4.28, 0.9, 4.26, 1.62], [2.35, 1.6], [2.3, 1.66], [1.75, 1.68], [1.7, 1.12], [0.42, 1.1], [0.06, 1.05, 0.03, 0.7]],
    glass: null
  }
};

export const HUES: Record<string, number[]> = {
  sedan: [0xc9ccd2, 0x2f3743, 0x7d8894, 0x2d5b7a, 0x8d3a30],
  suv: [0x3f4a3a, 0x55606c, 0xb9b3a8],
  taxi: [0xf0b429],
  pickup: [0x1f4f6d, 0xa8402f, 0xd9d7d0],
  van: [0xe4e2da, 0x6f7684],
  bus: [0xf2b134],
  police: [0xf0efe9],
  ambulance: [0xf4f3ee]
};

/** Liveries share a silhouette, so several kinds map onto the same profile. */
export function specOf(kind: VehicleKind) {
  const base = kind === 'taxi' || kind === 'police' ? 'sedan' : kind === 'ambulance' ? 'van' : kind;
  return SPEC[base] || SPEC.sedan;
}

/** Tallest point of the side profile. Used to size the physics hull. */
export function vehicleHeight(kind: VehicleKind) {
  const spec = specOf(kind);
  let top = 0;
  for (const seg of spec.top) {
    for (let i = 1; i < seg.length; i += 2) top = Math.max(top, seg[i]);
  }
  return top;
}

const UNIT = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
const CYL8 = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);

let mats: ReturnType<typeof makeMats> | null = null;
function makeMats() {
  const env = createAssets().env;
  return {
    env,
    glass: new THREE.MeshStandardMaterial({ color: 0x171f2a, metalness: 0.9, roughness: 0.08, envMap: env, envMapIntensity: 1.1 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x15181d, metalness: 0.05, roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xcfd3d9, metalness: 0.92, roughness: 0.24, envMap: env, envMapIntensity: 1.2 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xc2c7cd, metalness: 1, roughness: 0.16, envMap: env, envMapIntensity: 1.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x24282e, metalness: 0.35, roughness: 0.55 }),
    white: new THREE.MeshStandardMaterial({ color: 0xeeece5, metalness: 0.2, roughness: 0.45, envMap: env }),
    red: new THREE.MeshStandardMaterial({ color: 0xb63325, metalness: 0.3, roughness: 0.4, envMap: env }),
    head: new THREE.MeshStandardMaterial({ color: 0xf6f2e2, metalness: 0.4, roughness: 0.12, emissive: 0xffeeb0, emissiveIntensity: 0, envMap: env }),
    brake: new THREE.MeshStandardMaterial({ color: 0x8d2018, roughness: 0.25, emissive: 0xff2a15, emissiveIntensity: 0.15 }),
    barR: new THREE.MeshLambertMaterial({ color: 0x8e1a12, emissive: 0xff2010, emissiveIntensity: 0.8 }),
    barB: new THREE.MeshLambertMaterial({ color: 0x16305e, emissive: 0x2f6dff, emissiveIntensity: 0.8 }),
    body: {} as Record<number, THREE.MeshStandardMaterial>
  };
}
export function vehicleMats() {
  if (!mats) mats = makeMats();
  return mats;
}
function bodyMat(hex: number) {
  const m = vehicleMats();
  if (!m.body[hex]) {
    m.body[hex] = new THREE.MeshStandardMaterial({ color: hex, metalness: 0.55, roughness: 0.32, envMap: m.env, envMapIntensity: 1.15 });
  }
  return m.body[hex];
}

function pbox(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, shadow = false) {
  const m = new THREE.Mesh(UNIT, mat);
  m.scale.set(w, h, d); m.position.set(x, y, z);
  m.castShadow = shadow;
  parent.add(m);
  return m;
}
function pcyl(parent: THREE.Object3D, mat: THREE.Material, r: number, len: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z', low = false) {
  const m = new THREE.Mesh(low ? CYL8 : CYL, mat);
  m.scale.set(r * 2, len, r * 2); m.position.set(x, y, z);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  parent.add(m);
  return m;
}

function profileGeo(spec: Spec, width: number, bevel: number) {
  const sh = new THREE.Shape();
  sh.moveTo(0, spec.bottom);
  for (const a of spec.arches) {
    sh.lineTo(a.x - a.r, spec.bottom);
    sh.absarc(a.x, spec.bottom, a.r, Math.PI, 0, true);
  }
  sh.lineTo(spec.L, spec.bottom);
  for (const p of spec.top) {
    if (p.length === 4) sh.quadraticCurveTo(p[0], p[1], p[2], p[3]);
    else sh.lineTo(p[0], p[1]);
  }
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, {
    depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8, steps: 1
  });
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2 + bevel, 0, -spec.L / 2);
  g.computeVertexNormals();
  return g;
}

function bandGeo(pts: number[][], width: number) {
  const sh = new THREE.Shape();
  sh.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < pts.length; k++) sh.lineTo(pts[k][0], pts[k][1]);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: false, steps: 1, curveSegments: 4 });
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2, 0, 0);
  return g;
}

export function makeWheel(r: number, w: number, simple: boolean, truck = false) {
  const kit = kitWheel(r, w, truck);
  if (kit) {
    const g = new THREE.Group() as THREE.Group & { tire?: THREE.Mesh };
    g.add(kit);
    g.tire = kit;
    return g;
  }
  const m = vehicleMats();
  const g = new THREE.Group() as THREE.Group & { tire?: THREE.Mesh };
  const t = new THREE.Mesh(CYL, m.tire);
  t.scale.set(r * 2, w, r * 2); t.rotation.z = Math.PI / 2; t.castShadow = true;
  g.add(t);
  const rim = new THREE.Mesh(CYL8, m.rim);
  rim.scale.set(r * 1.18, w * 1.02, r * 1.18); rim.rotation.z = Math.PI / 2;
  g.add(rim);
  if (!simple) {
    for (let k = 0; k < 5; k++) {
      const sp = new THREE.Mesh(UNIT, m.rim);
      sp.scale.set(w * 1.06, r * 1.15, 0.09);
      sp.rotation.x = (k * Math.PI) / 5;
      g.add(sp);
    }
    const hub = new THREE.Mesh(CYL8, m.chrome);
    hub.scale.set(r * 0.5, w * 1.12, r * 0.5); hub.rotation.z = Math.PI / 2;
    g.add(hub);
  }
  g.tire = t;
  return g;
}

export type VehicleGroup = THREE.Group & { wheels?: THREE.Object3D[]; spec?: Spec };

function mountWheels(g: VehicleGroup, spec: Spec, simple: boolean, truck = false) {
  const zF = spec.arches[0].x - spec.L / 2;
  const zR = spec.arches[1].x - spec.L / 2;
  const ht = spec.W / 2 - spec.wr * 0.32;
  const spots = [[-ht, zF], [ht, zF], [-ht, zR], [ht, zR]];
  const wheels: THREE.Object3D[] = [];
  for (const [x, z] of spots) {
    const holder = new THREE.Group();
    holder.position.set(x, spec.wr, z);
    holder.add(makeWheel(spec.wr, spec.wr * 0.62, simple, truck));
    g.add(holder);
    wheels.push(holder);
  }
  g.wheels = wheels;
  return wheels;
}

/** Body only, no wheels: used by the physics car, which places wheels from the solver. */
export function makeChassis(kind: VehicleKind, hex: number, simple = false) {
  const m = vehicleMats();
  const spec = specOf(kind);
  const g = new THREE.Group() as VehicleGroup;
  g.spec = spec;
  const kit = kitBody(kind);
  if (kit) {
    g.add(kit);
    return g;
  }
  const base = kind === 'taxi' || kind === 'police' ? 'sedan' : kind === 'ambulance' ? 'van' : kind;
  const paint = bodyMat(hex);
  const half = spec.L / 2, front = -half, rear = half, W = spec.W;

  const body = new THREE.Mesh(profileGeo(spec, W - 0.12, 0.07), kind === 'ambulance' ? m.white : paint);
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);

  if (spec.glass) {
    const gl = new THREE.Mesh(bandGeo(spec.glass, W - 0.02), m.glass);
    gl.position.z = -half;
    g.add(gl);
  }
  pbox(g, m.chrome, W * 0.94, 0.2, 0.34, 0, spec.bottom + 0.26, front + 0.12);
  pbox(g, m.chrome, W * 0.94, 0.2, 0.34, 0, spec.bottom + 0.26, rear - 0.12);
  pbox(g, m.dark, W * 0.72, 0.18, 0.12, 0, spec.bottom + 0.5, front + 0.06);
  for (let k = -1; k <= 1; k += 2) {
    pcyl(g, m.head, 0.17, 0.14, k * (W / 2 - 0.34), spec.bottom + 0.55, front + 0.06, 'z');
    pbox(g, m.brake, 0.36, 0.18, 0.1, k * (W / 2 - 0.32), spec.bottom + 0.6, rear - 0.04);
    if (!simple) pbox(g, m.dark, 0.08, 0.12, 0.24, k * (W / 2 + 0.02), spec.bottom + 0.95, front + 1.5);
    pbox(g, m.dark, 0.06, 0.1, spec.L * 0.42, k * (W / 2 - 0.01), spec.bottom + 0.42, 0);
  }
  if (kind === 'taxi') {
    pbox(g, m.white, 0.8, 0.26, 0.36, 0, spec.bottom + 1.42, -0.4);
    pbox(g, m.dark, W * 0.9, 0.16, 0.5, 0, spec.bottom + 0.4, 0);
  }
  if (kind === 'police') {
    pbox(g, m.dark, W * 0.92, 0.22, spec.L * 0.3, 0, spec.bottom + 0.5, 0.2);
    pbox(g, m.dark, 1.4, 0.08, 0.4, 0, spec.bottom + 1.36, -0.2);
    pbox(g, m.barR, 0.5, 0.16, 0.36, -0.42, spec.bottom + 1.42, -0.2);
    pbox(g, m.barB, 0.5, 0.16, 0.36, 0.42, spec.bottom + 1.42, -0.2);
  }
  if (kind === 'ambulance') {
    pbox(g, m.red, W + 0.02, 0.24, spec.L * 0.62, 0, spec.bottom + 1.15, 0.5);
    pbox(g, m.dark, 0.9, 0.1, 0.42, 0, spec.bottom + 2.32, -1.5);
    pbox(g, m.barR, 0.42, 0.18, 0.38, -0.3, spec.bottom + 2.4, -1.5);
    pbox(g, m.barB, 0.42, 0.18, 0.38, 0.3, spec.bottom + 2.4, -1.5);
  }
  if (base === 'bus') {
    pbox(g, m.dark, 0.14, 1.7, 0.9, W / 2 - 0.02, spec.bottom + 1.2, -2.6);
    pbox(g, m.dark, 0.14, 1.7, 0.9, W / 2 - 0.02, spec.bottom + 1.2, 1.4);
    pbox(g, paint, W * 0.9, 0.22, spec.L * 0.9, 0, spec.bottom + 3.06, 0);
  }
  if (base === 'pickup') pbox(g, m.dark, W * 0.84, 0.08, spec.L * 0.36, 0, spec.bottom + 1.1, 1.35);
  if (kind === 'jeep') buildJeepDetails(g, spec);
  return g;
}

function buildJeepDetails(g: VehicleGroup, spec: Spec) {
  const m = vehicleMats();
  const half = spec.L / 2, front = -half, rear = half, W = spec.W;
  pbox(g, m.dark, W * 0.82, 0.5, 1.3, 0, spec.bottom + 1.02, 0.55);
  pbox(g, m.dark, W * 0.6, 0.12, 0.9, 0, spec.bottom + 1.36, -0.35);
  pbox(g, m.dark, W * 0.62, 0.66, 0.12, 0, spec.bottom + 0.86, front + 0.02);
  for (let k = -3; k <= 3; k++) pbox(g, m.chrome, 0.07, 0.5, 0.06, k * 0.19, spec.bottom + 0.86, front - 0.02);
  for (let k = -1; k <= 1; k += 2) {
    pcyl(g, m.dark, 0.25, 0.1, k * 0.62, spec.bottom + 0.86, front - 0.01, 'z');
    pcyl(g, m.head, 0.2, 0.16, k * 0.62, spec.bottom + 0.86, front - 0.05, 'z');
    pbox(g, m.brake, 0.28, 0.24, 0.1, k * 0.68, spec.bottom + 0.78, rear + 0.02);
    pbox(g, m.dark, 0.12, 0.86, 0.12, k * 0.9, spec.bottom + 1.62, -0.6);
    pbox(g, m.dark, 0.13, 0.13, 2.5, k * 0.9, spec.bottom + 2.05, 0.35);
    pbox(g, m.dark, 0.12, 0.86, 0.12, k * 0.9, spec.bottom + 1.62, 1.5);
    pbox(g, m.dark, 0.15, 0.42, 0.15, k * 1.04, spec.bottom + 0.1, 0.1);
    pbox(g, m.chrome, 0.09, 0.14, 0.26, k * 1.12, spec.bottom + 1.2, -1.15);
  }
  pbox(g, m.dark, W * 0.94, 1.0, 0.1, 0, spec.bottom + 1.6, -0.62);
  pbox(g, m.glass, W * 0.84, 0.86, 0.05, 0, spec.bottom + 1.6, -0.6);
  pbox(g, m.dark, W * 0.96, 0.12, 0.12, 0, spec.bottom + 2.12, -0.64);
  pbox(g, m.dark, 0.7, 0.5, 0.62, -0.44, spec.bottom + 1.1, 0.5);
  pbox(g, m.dark, 0.7, 0.5, 0.62, 0.44, spec.bottom + 1.1, 0.5);
  const spare = makeWheel(0.46, 0.3, true);
  spare.rotation.y = Math.PI / 2;
  spare.position.set(0.45, spec.bottom + 1.05, rear + 0.28);
  g.add(spare);
  pbox(g, m.dark, 2.24, 0.22, 0.3, 0, spec.bottom + 0.2, front - 0.1);
  pbox(g, m.dark, 2.24, 0.22, 0.3, 0, spec.bottom + 0.2, rear + 0.1);
}

/** Full vehicle with its own wheels: traffic and parked cars. */
export function makeVehicle(kind: VehicleKind, hex: number, simple = true) {
  const g = makeChassis(kind, hex, simple);
  mountWheels(g, g.spec!, simple, usesTruckWheel(kind));
  return g;
}

const protoCache: Record<string, VehicleGroup> = {};
export function cloneVehicle(kind: VehicleKind, hex: number) {
  const key = `${kind}_${hex}`;
  if (!protoCache[key]) protoCache[key] = makeVehicle(kind, hex, true);
  return protoCache[key].clone() as VehicleGroup;
}

export function pickHue(kind: VehicleKind, r: number) {
  const list = HUES[kind] || HUES.sedan;
  return list[Math.floor(r * list.length) % list.length];
}
