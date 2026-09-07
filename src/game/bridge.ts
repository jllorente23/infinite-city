import * as THREE from 'three';
import { BRIDGE_DECK, BRIDGE_RISE, BRIDGE_SPAN, CANAL_W } from './config';
import { heightAt } from './rng';

export function bridgeLiftAmount(along: number, span = BRIDGE_SPAN, rise = BRIDGE_RISE) {
  const t = along / (span / 2);
  if (Math.abs(t) > 1) return 0;
  return rise * 0.5 * (1 + Math.cos(Math.PI * t));
}

export type BridgeMats = {
  deck: THREE.Material;
  walk: THREE.Material;
  stone: THREE.Material;
  steel: THREE.Material;
  rail: THREE.Material;
  under: THREE.Material;
};

export type BoxCollider = { pos: [number, number, number]; half: [number, number, number] };

/**
 * Half of a city canal bridge: a thick arched deck, sidewalk, parapet, steel
 * girders and concrete piers. The neighbouring cell builds the other half, so
 * the pair reads as one wide crossing instead of a skinny ramp.
 *
 * `innerSign` is +1 or -1 in the lateral axis and points toward this cell's
 * interior, which is where the parapet goes.
 */
export function assembleBridge(
  alongX: boolean,
  cx: number,
  cz: number,
  innerSign: number,
  mats: BridgeMats,
  trash: THREE.BufferGeometry[],
  boxes: BoxCollider[]
) {
  const group = new THREE.Group();
  const span = BRIDGE_SPAN;
  const deckW = BRIDGE_DECK;
  const rise = BRIDGE_RISE;
  const walkW = 1.35;
  const deckH = 0.62;
  const segs = 10;

  const world = (along: number, lat: number) => {
    const x = alongX ? cx + along : cx + lat;
    const z = alongX ? cz + lat : cz + along;
    return { x, z, y: heightAt(x, z) + bridgeLiftAmount(along, span, rise) };
  };

  const box = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number, y: number, z: number,
    yaw = 0,
    shadow = true
  ) => {
    trash.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (yaw) m.rotation.y = yaw;
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    group.add(m);
    return m;
  };

  // Thick deck in segments so the underside reads as a real structure.
  for (let k = 0; k < segs; k++) {
    const a0 = ((k / segs) - 0.5) * span;
    const a1 = (((k + 1) / segs) - 0.5) * span;
    const mid = (a0 + a1) / 2;
    const len = a1 - a0 + 0.08;
    const p = world(mid, 0);
    const pL = world(mid - len / 2, 0);
    const pR = world(mid + len / 2, 0);
    const pitch = Math.atan2(pR.y - pL.y, len);
    const slab = alongX
      ? new THREE.BoxGeometry(len, deckH, deckW)
      : new THREE.BoxGeometry(deckW, deckH, len);
    const mesh = box(slab, mats.deck, p.x, p.y - deckH / 2 - 0.03, p.z);
    if (alongX) mesh.rotation.z = -pitch;
    else mesh.rotation.x = pitch;

    const walkLat = innerSign * (deckW / 2 - walkW / 2);
    const w = world(mid, walkLat);
    const walk = alongX
      ? new THREE.BoxGeometry(len, 0.22, walkW)
      : new THREE.BoxGeometry(walkW, 0.22, len);
    const walkM = box(walk, mats.walk, w.x, w.y + 0.14, w.z, 0, true);
    if (alongX) walkM.rotation.z = -pitch;
    else walkM.rotation.x = pitch;
  }

  // Parapet + posts + rail on the inner edge so you cannot drive into the canal.
  const railLat = innerSign * (deckW / 2 + 0.12);
  const posts = 12;
  for (let k = 0; k <= posts; k++) {
    const along = ((k / posts) - 0.5) * (span - 1.2);
    const p = world(along, railLat);
    box(new THREE.BoxGeometry(0.22, 1.35, 0.22), mats.stone, p.x, p.y + 0.78, p.z);
    boxes.push({ pos: [p.x, p.y + 0.7, p.z], half: [0.2, 0.75, 0.2] });
  }
  for (let k = 0; k < posts; k++) {
    const a0 = ((k / posts) - 0.5) * (span - 1.2);
    const a1 = (((k + 1) / posts) - 0.5) * (span - 1.2);
    const mid = (a0 + a1) / 2;
    const p = world(mid, railLat);
    const len = Math.abs(a1 - a0) + 0.1;
    const rail = alongX
      ? new THREE.BoxGeometry(len, 0.16, 0.12)
      : new THREE.BoxGeometry(0.12, 0.16, len);
    box(rail, mats.rail, p.x, p.y + 1.28, p.z);
    const wall = alongX
      ? new THREE.BoxGeometry(len, 0.72, 0.28)
      : new THREE.BoxGeometry(0.28, 0.72, len);
    box(wall, mats.stone, p.x, p.y + 0.42, p.z);
    boxes.push({
      pos: [p.x, p.y + 0.55, p.z],
      half: alongX ? [len / 2, 0.7, 0.2] : [0.2, 0.7, len / 2]
    });
  }

  // Steel girders under the deck.
  for (const girderLat of [-deckW * 0.28, deckW * 0.28]) {
    for (let k = 0; k < segs; k++) {
      const mid = ((k + 0.5) / segs - 0.5) * span;
      const p = world(mid, girderLat);
      const len = span / segs + 0.12;
      const beam = alongX
        ? new THREE.BoxGeometry(len, 0.55, 0.32)
        : new THREE.BoxGeometry(0.32, 0.55, len);
      box(beam, mats.steel, p.x, p.y - deckH - 0.22, p.z);
    }
  }

  // Concrete piers standing in the water.
  const pierAlong = [-CANAL_W * 0.28, 0, CANAL_W * 0.28];
  for (const along of pierAlong) {
    const lat = innerSign * (deckW * 0.22);
    const x = alongX ? cx + along : cx + lat;
    const z = alongX ? cz + lat : cz + along;
    const top = world(along, lat);
    const baseY = heightAt(x, z) - 3.35;
    const h = Math.max(2.8, top.y - 0.85 - baseY);
    const cy = baseY + h / 2;
    const pier = alongX
      ? new THREE.BoxGeometry(1.7, h, 1.35)
      : new THREE.BoxGeometry(1.35, h, 1.7);
    box(pier, mats.stone, x, cy, z);
    const cap = alongX
      ? new THREE.BoxGeometry(2.3, 0.38, 1.8)
      : new THREE.BoxGeometry(1.8, 0.38, 2.3);
    box(cap, mats.stone, x, top.y - 0.72, z);
    boxes.push({ pos: [x, cy, z], half: alongX ? [0.85, h / 2, 0.68] : [0.68, h / 2, 0.85] });
  }

  // Abutments where the deck meets the bank, so the join is a wall, not a lip.
  for (const end of [-1, 1]) {
    const along = end * (span / 2 - 0.6);
    const lat = innerSign * (deckW / 2 - 0.2);
    const p = world(along, lat);
    const abut = alongX
      ? new THREE.BoxGeometry(2.4, 2.1, 1.1)
      : new THREE.BoxGeometry(1.1, 2.1, 2.4);
    box(abut, mats.under, p.x, p.y - 0.85, p.z);
    boxes.push({
      pos: [p.x, p.y - 0.4, p.z],
      half: alongX ? [1.2, 1.1, 0.55] : [0.55, 1.1, 1.2]
    });
  }

  return group;
}
