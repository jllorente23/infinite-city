import * as THREE from 'three';
import { BLOCK, CANAL_W, CELL, HW_MEDIAN, HW_WIDTH, LOT_AISLE, LOT_COLS, LOT_ROWS, LOT_SLOT_D, LOT_SLOT_W, PALETTE, SIDEWALK, STREET } from './config';
import { hash3, heightAt, mulberry32 } from './rng';
import { buildingGeo, createAssets, mergeBoxes } from './textures';
import { cityProps, LAMP_HEAD, propYaw, SIGNAL_LENS_OUT, SIGNAL_LENS_Y } from './props';
import { cityNature, GROUND_KINDS, KERB_KINDS, NatureKind, TREE_KINDS } from './nature';
import { makeSign, SignKind } from './signs';
import { cityBuildings, HOUSE_KINDS, MID_KINDS, TOWER_KINDS, BuildingKind } from './buildings';
import { cloneVehicle, pickHue, VehicleKind } from './vehicles';

const UP = new THREE.Vector3(0, 1, 0);

export type BlockType = 'canal' | 'highway' | 'avenue' | 'mall' | 'parking' | 'works' | 'tower' | 'build' | 'park' | 'plaza' | 'low';
export type HighwayAxis = 'x' | 'z' | 'both';

export type BoxCollider = { pos: [number, number, number]; half: [number, number, number] };
export type SignalDef = { nx: number; nz: number; axisX: boolean; dots: THREE.Mesh[] };

export type ChunkData = {
  key: string;
  i: number;
  j: number;
  lod: number;
  type: BlockType;
  group: THREE.Group;
  boxes: BoxCollider[];
  ground: THREE.BufferGeometry | null;
  signals: SignalDef[];
  dispose: () => void;
};

const PARK_KINDS: VehicleKind[] = ['sedan', 'sedan', 'suv', 'pickup', 'van', 'taxi'];

function cellOf(v: number) {
  return Math.floor(v / CELL);
}
function localOf(v: number) {
  return ((v % CELL) + CELL) % CELL;
}

/** True when a point sits on the asphalt grid (streets + junctions). */
function onRoadway(x: number, z: number, pad = 0) {
  const lx = localOf(x);
  const lz = localOf(z);
  return lz < STREET / 2 + pad || lz > CELL - STREET / 2 - pad
    || lx < STREET / 2 + pad || lx > CELL - STREET / 2 - pad;
}

function onHighwayDeck(seed: number, x: number, z: number, pad = 0) {
  const i = cellOf(x), j = cellOf(z);
  const axis = highwayAxis(seed, i, j);
  if (!axis) return false;
  const half = HW_WIDTH / 2 + pad;
  const lx = localOf(x), lz = localOf(z);
  if ((axis === 'x' || axis === 'both') && Math.abs(lz - CELL / 2) < half) return true;
  if ((axis === 'z' || axis === 'both') && Math.abs(lx - CELL / 2) < half) return true;
  return false;
}

function onAvenueDeck(seed: number, x: number, z: number, pad = 0) {
  const i = cellOf(x), j = cellOf(z);
  if (blockTypeAt(seed, i, j) !== 'avenue') return false;
  const cx = i * CELL + CELL / 2, cz = j * CELL + CELL / 2;
  const w = STREET / 2 + pad;
  if (isAveA(seed, i, j) && Math.abs((x - cx) + (z - cz)) / Math.SQRT2 < w) return true;
  if (isAveB(seed, i, j) && Math.abs((x - cx) - (z - cz)) / Math.SQRT2 < w) return true;
  return false;
}

function onDriveable(seed: number, x: number, z: number, pad = 0) {
  return onRoadway(x, z, pad) || onHighwayDeck(seed, x, z, pad) || onAvenueDeck(seed, x, z, pad);
}

function plantRadius(kind: NatureKind, s: number) {
  const nature = cityNature();
  const box = nature?.[kind]?.geometry.boundingBox;
  if (box) {
    const hx = Math.max(Math.abs(box.min.x), Math.abs(box.max.x));
    const hz = Math.max(Math.abs(box.min.z), Math.abs(box.max.z));
    return Math.max(hx, hz) * s + 1.15;
  }
  return (TREE_KINDS.includes(kind) ? 2.6 : 1.7) * s + 1.1;
}

/** Low frequency layer: districts, so towers cluster and suburbs spread out. */
function district(seed: number, i: number, j: number) {
  return mulberry32(hash3(seed, Math.floor(i / 6) + 1000, Math.floor(j / 6) + 1000))();
}
function bandPick(seed: number, v: number, salt: number) {
  const band = Math.floor(v / 16);
  const r = mulberry32(hash3(seed, band, salt));
  const pick = Math.floor(r() * 16);
  const on = r() < 0.42;
  return on && v - band * 16 === pick;
}
export const isCanalCol = (seed: number, i: number) => bandPick(seed, i, 777);
export const isCanalRow = (seed: number, j: number) => bandPick(seed, j, 888);
const isAveA = (seed: number, i: number, j: number) => mulberry32(hash3(seed, i + j, 4242))() < 0.05;
const isAveB = (seed: number, i: number, j: number) => mulberry32(hash3(seed, i - j, 4343))() < 0.05;

/** One dual-carriageway every ~10 blocks, so you meet an autopista while driving. */
function corridorPick(seed: number, v: number, salt: number) {
  const period = 8;
  const band = Math.floor(v / period);
  const r = mulberry32(hash3(seed, band, salt));
  const pick = Math.floor(r() * period);
  return r() < 0.72 && v - band * period === pick;
}
export const isHwyCol = (seed: number, i: number) => corridorPick(seed, i, 555);
export const isHwyRow = (seed: number, j: number) => corridorPick(seed, j, 666);

export function canalAxis(seed: number, i: number, j: number): HighwayAxis | null {
  const col = isCanalCol(seed, i);
  const row = isCanalRow(seed, j);
  if (col && row) return 'both';
  if (col) return 'z';
  if (row) return 'x';
  return null;
}

export function highwayAxis(seed: number, i: number, j: number): HighwayAxis | null {
  const col = isHwyCol(seed, i);
  const row = isHwyRow(seed, j);
  if (col && row) return 'both';
  if (col) return 'z';
  if (row) return 'x';
  return null;
}

/** One cell owns each junction so a crossing never gets 16 poles. */
export function hasSignals(seed: number, jx: number, jz: number) {
  const nI = Math.round(jx / CELL);
  const nJ = Math.round(jz / CELL);
  const cells: [number, number][] = [[nI - 1, nJ - 1], [nI, nJ - 1], [nI - 1, nJ], [nI, nJ]];
  if (cells.some(([ci, cj]) => highwayAxis(seed, ci, cj) || canalAxis(seed, ci, cj))) return false;
  const types = cells.map(([ci, cj]) => blockTypeAt(seed, ci, cj));
  const busy = types.filter((t) => t === 'tower' || t === 'build' || t === 'mall' || t === 'works').length;
  if (busy < 1) return false;
  return ((hash3(seed, nI + 17, nJ + 9001) >>> 0) % 100) < 48;
}

export function blockTypeAt(seed: number, i: number, j: number): BlockType {
  const rnd = mulberry32(hash3(seed, i, j));
  const dens = district(seed, i, j);
  const r = rnd();
  if (highwayAxis(seed, i, j)) return 'highway';
  if (canalAxis(seed, i, j)) return 'canal';
  if (isAveA(seed, i, j) || isAveB(seed, i, j)) return 'avenue';
  if (r < 0.06 && dens < 0.62) return 'mall';
  if (r < 0.14 && dens < 0.72) return 'parking';
  if (r < 0.2 && dens < 0.58) return 'works';
  if (r < 0.12 + dens * 0.45) return dens > 0.55 ? 'tower' : 'build';
  if (r < 0.62 + dens * 0.25) return 'build';
  if (r < 0.84) return 'park';
  if (r < 0.92) return 'plaza';
  return 'low';
}

/** Join several terrain patches into one indexed mesh for a single trimesh. */
function mergePatches(parts: THREE.BufferGeometry[]) {
  let vCount = 0;
  let iCount = 0;
  for (const g of parts) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const index = new Uint32Array(iCount);
  let vOff = 0;
  let iOff = 0;
  for (const g of parts) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array as Float32Array, vOff * 3);
    nor.set(g.attributes.normal.array as Float32Array, vOff * 3);
    const src = g.index ? (g.index.array as ArrayLike<number>) : null;
    const count = src ? src.length : n;
    for (let k = 0; k < count; k++) index[iOff + k] = (src ? src[k] : k) + vOff;
    vOff += n;
    iOff += count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

/** A terrain-following patch of ground. Also reused as the physics trimesh. */
function patch(cx: number, cz: number, w: number, l: number, yaw: number, segW: number, segL: number, yOff: number, uvBox?: number[]) {
  const g = new THREE.PlaneGeometry(w, l, segW, segL);
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  for (let k = 0; k < p.count; k++) {
    const px = p.getX(k), py = -p.getY(k);
    const rx = px * cs - py * sn, rz = px * sn + py * cs;
    const wx = cx + rx, wz = cz + rz;
    p.setXYZ(k, wx, heightAt(wx, wz) + yOff, wz);
    if (uvBox) uv.setXY(k, uvBox[0] + uv.getX(k) * (uvBox[1] - uvBox[0]), uvBox[2] + uv.getY(k) * (uvBox[3] - uvBox[2]));
  }
  const idx = g.index!.array as ArrayLike<number>;
  const a = new THREE.Vector3().fromBufferAttribute(p as THREE.BufferAttribute, idx[0]);
  const b = new THREE.Vector3().fromBufferAttribute(p as THREE.BufferAttribute, idx[1]);
  const c = new THREE.Vector3().fromBufferAttribute(p as THREE.BufferAttribute, idx[2]);
  if (b.sub(a).cross(c.sub(a)).y < 0) {
    const arr = g.index!.array as any;
    for (let k = 0; k < arr.length; k += 3) { const t = arr[k + 1]; arr[k + 1] = arr[k + 2]; arr[k + 2] = t; }
  }
  g.computeVertexNormals();
  return g;
}

export function generateChunk(seed: number, i: number, j: number, lod: number): ChunkData {
  const { mats, geos } = createAssets();
  const rnd = mulberry32(hash3(seed, i, j));
  const detail = lod === 2;
  const far = lod === 0;
  const group = new THREE.Group();
  const boxes: BoxCollider[] = [];
  const trash: THREE.BufferGeometry[] = [];
  const signals: SignalDef[] = [];

  const ox = i * CELL, oz = j * CELL;
  const cx = ox + CELL / 2, cz = oz + CELL / 2;
  const hc = heightAt(cx, cz);
  const inner = BLOCK - SIDEWALK * 2;
  const dens = district(seed, i, j);
  const type = blockTypeAt(seed, i, j);
  const segs = detail ? 10 : far ? 3 : 5;

  const trees: { x: number; z: number; s: number; kind: NatureKind }[] = [];
  const plants: { x: number; z: number; s: number; yaw: number; kind: NatureKind }[] = [];
  const lamps: { x: number; z: number; yaw: number }[] = [];
  const lotCars: { x: number; z: number; half: number; n: number; yaw: number }[] = [];
  const farBoxes: any[] = [];

  let ground: THREE.BufferGeometry | null = null;

  const flat = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, yaw = 0, shadow = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (yaw) m.rotation.y = yaw;
    m.receiveShadow = shadow;
    group.add(m);
    return m;
  };

  const addWater = (axis: HighwayAxis) => {
    const wy = hc - 2.75;
    if (axis === 'x' || axis === 'both') {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(CELL, CANAL_W), mats.water);
      w.rotation.x = -Math.PI / 2;
      w.position.set(cx, wy, cz);
      group.add(w);
    }
    if (axis === 'z' || axis === 'both') {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(CANAL_W, CELL), mats.water);
      w.rotation.x = -Math.PI / 2;
      w.position.set(cx, wy, cz);
      group.add(w);
    }
    boxes.push({ pos: [cx, hc - 2.15, cz], half: [CANAL_W / 2 - 0.4, 0.55, CANAL_W / 2 - 0.4] });
  };

  if (type === 'canal') {
    const axis = canalAxis(seed, i, j) ?? 'x';
    const f = STREET / 2 / CELL;
    const strips = [
      patch(cx, oz + STREET / 4, CELL, STREET / 2, 0, segs, 1, 0, [0, 1, 1 - f, 1]),
      patch(cx, oz + CELL - STREET / 4, CELL, STREET / 2, 0, segs, 1, 0, [0, 1, 0, f]),
      patch(ox + STREET / 4, cz, STREET / 2, CELL, 0, 1, segs, 0, [0, f, 0, 1]),
      patch(ox + CELL - STREET / 4, cz, STREET / 2, CELL, 0, 1, segs, 0, [1 - f, 1, 0, 1])
    ];
    strips.forEach((g) => {
      trash.push(g);
      const m = new THREE.Mesh(g, mats.tile);
      m.receiveShadow = true;
      group.add(m);
    });
    if (axis !== 'both') {
      const alongX = axis === 'z';
      const br = alongX
        ? patch(cx, cz, CELL, STREET + 1.2, 0, segs, 2, 0.42)
        : patch(cx, cz, STREET + 1.2, CELL, 0, 2, segs, 0.42);
      trash.push(br);
      const deck = new THREE.Mesh(br, mats.strip);
      deck.receiveShadow = true;
      group.add(deck);
      strips.push(br);
      if (alongX) {
        for (const s of [-1, 1]) flat(geos.railX, mats.rail, cx, hc + 0.95, cz + s * (STREET / 2 + 0.35));
      } else {
        for (const s of [-1, 1]) flat(geos.railZ, mats.rail, cx + s * (STREET / 2 + 0.35), hc + 0.95, cz);
      }
    }
    ground = mergePatches(strips);
    trash.push(ground);
    addWater(axis);
    const half = CANAL_W / 2;
    if (axis === 'x' || axis === 'both') {
      for (const s of [-1, 1]) {
        flat(geos.quayX, mats.deck, cx, hc - 2.1, cz + s * half);
        boxes.push({ pos: [cx, hc + 0.15, cz + s * half], half: [BLOCK / 2, 0.85, 0.28] });
      }
    }
    if (axis === 'z' || axis === 'both') {
      for (const s of [-1, 1]) {
        flat(geos.quayZ, mats.deck, cx + s * half, hc - 2.1, cz);
        boxes.push({ pos: [cx + s * half, hc + 0.15, cz], half: [0.28, 0.85, BLOCK / 2] });
      }
    }
  } else if (type === 'highway') {
    const axis = highwayAxis(seed, i, j) ?? 'x';
    const tg = patch(cx, cz, CELL, CELL, 0, segs, segs, 0);
    trash.push(tg);
    ground = tg;
    const hwyMat = axis === 'x' ? mats.hwyX : axis === 'z' ? mats.hwyZ : mats.hwyBoth;
    const tile = new THREE.Mesh(tg, hwyMat);
    tile.receiveShadow = true;
    group.add(tile);

    const waterAxis = canalAxis(seed, i, j);
    if (waterAxis) {
      addWater(waterAxis);
      const half = CANAL_W / 2;
      if (waterAxis === 'x' || waterAxis === 'both') {
        for (const s of [-1, 1]) {
          flat(geos.quayX, mats.deck, cx, hc - 2.1, cz + s * half);
        }
      }
      if (waterAxis === 'z' || waterAxis === 'both') {
        for (const s of [-1, 1]) {
          flat(geos.quayZ, mats.deck, cx + s * half, hc - 2.1, cz);
        }
      }
      if (axis !== 'both') {
        const alongX = axis === 'x';
        for (const s of [-1, 1]) {
          if (alongX) flat(geos.railX, mats.rail, cx, hc + 0.95, cz + s * (HW_WIDTH / 2 + 0.4));
          else flat(geos.railZ, mats.rail, cx + s * (HW_WIDTH / 2 + 0.4), hc + 0.95, cz);
        }
      }
    }

    if (axis !== 'both') {
      const alongX = axis === 'x';
      const mg = alongX
        ? patch(cx, cz, BLOCK - 1.2, HW_MEDIAN - 0.2, 0, segs, 1, 0.14)
        : patch(cx, cz, HW_MEDIAN - 0.2, BLOCK - 1.2, 0, 1, segs, 0.14);
      trash.push(mg);
      const median = new THREE.Mesh(mg, mats.grass);
      median.receiveShadow = true;
      group.add(median);
      const barG = new THREE.BoxGeometry(alongX ? 6.4 : 0.4, 1.02, alongX ? 0.4 : 6.4);
      trash.push(barG);
      for (let k = -2; k <= 2; k++) {
        const bx = alongX ? cx + k * 6.6 : cx;
        const bz = alongX ? cz : cz + k * 6.6;
        const by = heightAt(bx, bz);
        const bar = new THREE.Mesh(barG, mats.jersey);
        bar.position.set(bx, by + 0.52, bz);
        bar.castShadow = true;
        group.add(bar);
        boxes.push({
          pos: [bx, by + 0.52, bz],
          half: alongX ? [3.2, 0.52, 0.22] : [0.22, 0.52, 3.2]
        });
      }
    }

    const side = HW_WIDTH / 2 + 1.7;
    if (axis === 'both') {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          lamps.push({ x: cx + sx * side, z: cz + sz * side, yaw: propYaw(sx, sz) });
        }
      }
    } else if (axis === 'x') {
      for (const s of [-1, 1]) {
        for (let k = 0; k < 2; k++) {
          lamps.push({ x: cx + (k ? 0.28 : -0.28) * BLOCK, z: cz + s * side, yaw: propYaw(0, s) });
        }
      }
    } else {
      for (const s of [-1, 1]) {
        for (let k = 0; k < 2; k++) {
          lamps.push({ x: cx + s * side, z: cz + (k ? 0.28 : -0.28) * BLOCK, yaw: propYaw(s, 0) });
        }
      }
    }
  } else {
    const tg = patch(cx, cz, CELL, CELL, 0, segs, segs, 0);
    trash.push(tg);
    ground = tg;
    // The diagonal avenue is its own glossy strip over the regular city tile.
    // A fully asphalt base made the whole block look like roadway and left
    // vegetation standing in the middle of it.
    const tile = new THREE.Mesh(tg, mats.tile);
    tile.receiveShadow = true;
    group.add(tile);
    for (let k = 0; k < 4; k++) {
      const ex = k % 2 ? 1 : -1;
      const ez = k < 2 ? 1 : -1;
      const sx = cx + ex * (BLOCK / 2 - 1.2);
      const sz = cz + ez * (BLOCK / 2 - 1.2);
      let ok = true;
      if (type === 'avenue') {
        if (isAveA(seed, i, j) && Math.abs(sx - cx + (sz - cz)) / 1.4142 < STREET / 2 + 3) ok = false;
        if (isAveB(seed, i, j) && Math.abs(sx - cx - (sz - cz)) / 1.4142 < STREET / 2 + 3) ok = false;
      }
      // Lean each lamp's arm over a different one of the four streets, so a block
      // lights all of its kerbs instead of doubling up on one.
      const armAlongX = k === 0 || k === 3;
      if (ok) lamps.push({ x: sx, z: sz, yaw: armAlongX ? propYaw(ex, 0) : propYaw(0, ez) });
    }
  }

  if (type === 'avenue') {
    const yaws: number[] = [];
    if (isAveA(seed, i, j)) yaws.push(Math.PI / 4);
    if (isAveB(seed, i, j)) yaws.push(-Math.PI / 4);
    for (const yaw of yaws) {
      const sg = patch(cx, cz, STREET, CELL * 1.4142 + 1, yaw, 2, segs + 4, 0.2);
      trash.push(sg);
      const m = new THREE.Mesh(sg, mats.strip);
      m.receiveShadow = true;
      group.add(m);
    }
    // Keep avenue blocks open. Even trees outside the diagonal strip cast a
    // canopy over one of its lanes and read as if they grew through asphalt.
  } else if (type === 'parking' || type === 'mall' || type === 'works') {
    const half = inner / 2;
    flat(geos.inner, type === 'works' ? mats.lot : mats.lotFloor, cx, hc - 0.16, cz, 0, true);
    const lotSkirtG = new THREE.BoxGeometry(inner + 0.4, 3.8, inner + 0.4);
    trash.push(lotSkirtG);
    const lotSkirt = new THREE.Mesh(lotSkirtG, mats.under);
    lotSkirt.position.set(cx, hc - 2.1, cz);
    group.add(lotSkirt);
    boxes.push({ pos: [cx, hc + 0.04, cz], half: [half, 0.4, half] });
    if (type === 'works') {
      const catalog = cityBuildings();
      const sheds = 1 + (rnd() < 0.45 ? 1 : 0);
      for (let k = 0; k < sheds; k++) {
        const ww = inner * (0.42 + rnd() * 0.2);
        const dd = inner * (0.28 + rnd() * 0.12);
        const hh = 6.5 + rnd() * 3.2;
        const oxs = sheds === 1 ? 0 : (k ? 1 : -1) * inner * 0.22;
        const ozs = (rnd() < 0.5 ? 1 : -1) * inner * 0.08;
        const bx = cx + oxs, bz = cz + ozs;
        const gy = heightAt(bx, bz);
        if (catalog) {
          const kind = MID_KINDS[Math.floor(rnd() * MID_KINDS.length)];
          const b = catalog[kind];
          const fit = Math.min(ww / b.size.w, dd / b.size.d);
          const bh = Math.max(5.5, Math.min(b.size.h * fit * 0.85, hh));
          const mesh = new THREE.Mesh(b.geometry, b.material);
          mesh.position.set(bx, gy, bz);
          mesh.scale.set(fit, bh / b.size.h, fit);
          mesh.rotation.y = rnd() < 0.5 ? 0 : Math.PI / 2;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          group.add(mesh);
          boxes.push({ pos: [bx, gy + bh / 2, bz], half: [b.size.w * fit / 2, bh / 2, b.size.d * fit / 2] });
        } else {
          const geo = buildingGeo(ww, hh, dd);
          trash.push(geo);
          const mesh = new THREE.Mesh(geo, mats.mallWall);
          mesh.position.set(bx, gy + hh / 2, bz);
          mesh.castShadow = true;
          group.add(mesh);
          boxes.push({ pos: [bx, gy + hh / 2, bz], half: [ww / 2, hh / 2, dd / 2] });
        }
      }
      const tanks = 2 + Math.floor(rnd() * 2);
      for (let k = 0; k < tanks; k++) {
        const tx = cx + (rnd() * 2 - 1) * (half - 5);
        const tz = cz + (rnd() * 2 - 1) * (half - 5);
        if (onDriveable(seed, tx, tz, 3)) continue;
        const rad = 1.4 + rnd() * 0.7;
        const th = 3.2 + rnd() * 1.6;
        const tankG = new THREE.CylinderGeometry(rad, rad, th, 10);
        trash.push(tankG);
        const tank = new THREE.Mesh(tankG, mats.metal);
        tank.position.set(tx, heightAt(tx, tz) + th / 2, tz);
        tank.castShadow = true;
        group.add(tank);
        boxes.push({ pos: [tx, heightAt(tx, tz) + th / 2, tz], half: [rad, th / 2, rad] });
      }
    } else if (type === 'parking') {
      const gap = Math.floor(rnd() * 4);
      if (gap !== 0) flat(geos.lotWallX, mats.stone, cx, hc + 0.65, cz - half, 0, true);
      if (gap !== 1) flat(geos.lotWallX, mats.stone, cx, hc + 0.65, cz + half, 0, true);
      if (gap !== 2) flat(geos.lotWallZ, mats.stone, cx - half, hc + 0.65, cz, 0, true);
      if (gap !== 3) flat(geos.lotWallZ, mats.stone, cx + half, hc + 0.65, cz, 0, true);
      for (let k = 0; k < 2; k++) {
        const px = cx + (k ? 1 : -1) * half * 0.5;
        flat(geos.lotPole, mats.pole, px, heightAt(px, cz) + 3.5, cz, 0, true);
        flat(geos.lotHead, mats.bulb, px, heightAt(px, cz) + 6.9, cz);
      }
      lotCars.push({ x: cx, z: cz, half, n: 8 + Math.floor(rnd() * 6), yaw: rnd() < 0.5 ? 0 : Math.PI / 2 });
    } else {
      const mw = inner * 0.86, md = inner * 0.5, mh = 9 + rnd() * 4;
      const side = rnd() < 0.5 ? -1 : 1;
      const mz = cz + side * (half - md / 2);
      const mg = buildingGeo(mw, mh, md);
      trash.push(mg);
      const mesh = new THREE.Mesh(mg, mats.mallWall);
      mesh.position.set(cx, heightAt(cx, mz) + mh / 2, mz);
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
      const bandG = new THREE.BoxGeometry(mw + 0.4, 1.6, md + 0.4);
      trash.push(bandG);
      const band = new THREE.Mesh(bandG, mats.mallBand);
      band.position.set(cx, heightAt(cx, mz) + mh - 1.4, mz);
      group.add(band);
      const frontZ = mz - side * (md / 2 + 0.2);
      const glassG = new THREE.BoxGeometry(mw * 0.72, 4.4, 0.35);
      trash.push(glassG);
      const glass = new THREE.Mesh(glassG, mats.mallGlass);
      glass.position.set(cx, heightAt(cx, frontZ) + 2.4, frontZ);
      group.add(glass);
      flat(geos.mallSign, mats.sign, cx, heightAt(cx, mz) + mh + 1.1, mz);
      boxes.push({ pos: [cx, heightAt(cx, mz) + mh / 2, mz], half: [mw / 2, mh / 2, md / 2] });
      lotCars.push({ x: cx, z: cz - side * half * 0.45, half: half * 0.75, n: 5 + Math.floor(rnd() * 4), yaw: 0 });
    }
  } else if (type !== 'canal' && type !== 'highway') {
    if (!far) flat(geos.curb, mats.curb, cx, hc - 1.05, cz);
    flat(geos.sidewalk, mats.sidewalk, cx, hc - 1.0, cz, 0, true);
    const skirt = new THREE.Mesh(geos.skirt, mats.under);
    skirt.position.set(cx, hc - 2.55, cz);
    group.add(skirt);
    boxes.push({ pos: [cx, hc - 0.15, cz], half: [BLOCK / 2 - 0.15, 0.55, BLOCK / 2 - 0.15] });

    const isGreen = type === 'park' || type === 'plaza';
    if (isGreen) {
      flat(geos.inner, type === 'park' ? mats.grass : mats.plaza, cx, hc - 0.16, cz, 0, true);
      if (type === 'plaza') {
        const basin = new THREE.Mesh(geos.basin, mats.stone);
        basin.position.set(cx, hc + 0.8, cz); basin.castShadow = true; group.add(basin);
        const water = new THREE.Mesh(geos.fountain, mats.water);
        water.position.set(cx, hc + 1.25, cz); group.add(water);
        const jet = new THREE.Mesh(geos.jet, mats.stone);
        jet.position.set(cx, hc + 2.5, cz); jet.castShadow = true; group.add(jet);
        // A filled cube, even a short one, swallows wheel rays once the car
        // is on the basin. Four rim walls leave the water hollow so the
        // sidewalk underneath keeps contact.
        const rim = 5.4, thick = 0.45, rh = 0.55;
        boxes.push({ pos: [cx, hc + 0.85, cz - rim + thick], half: [rim, rh, thick] });
        boxes.push({ pos: [cx, hc + 0.85, cz + rim - thick], half: [rim, rh, thick] });
        boxes.push({ pos: [cx - rim + thick, hc + 0.85, cz], half: [thick, rh, rim - thick] });
        boxes.push({ pos: [cx + rim - thick, hc + 0.85, cz], half: [thick, rh, rim - thick] });
        for (let k = 0; k < 4; k++) {
          const ang = (k * Math.PI) / 2 + 0.4;
          const bx = cx + Math.cos(ang) * 8.2;
          const bz = cz + Math.sin(ang) * 8.2;
          flat(geos.bench, mats.wood, bx, hc + 0.42, bz, ang + Math.PI / 2);
          flat(geos.benchBack, mats.wood, bx - Math.cos(ang) * 0.22, hc + 0.72, bz - Math.sin(ang) * 0.22, ang + Math.PI / 2);
        }
        for (let k = 0; k < 4; k++) {
          const tx = cx + (k % 2 ? 1 : -1) * (inner / 2 - 3.2);
          const tz = cz + (k < 2 ? 1 : -1) * (inner / 2 - 3.2);
          if (!onDriveable(seed, tx, tz, 4.2)) trees.push({ x: tx, z: tz, s: 0.95, kind: TREE_KINDS[k % TREE_KINDS.length] });
        }
      } else {
        const count = 7 + Math.floor(rnd() * 7);
        let tries = 0;
        while (trees.length < count && tries < 40) {
          tries++;
          const tx = cx + (rnd() * 2 - 1) * (inner / 2 - 3);
          const tz = cz + (rnd() * 2 - 1) * (inner / 2 - 3);
          if (onDriveable(seed, tx, tz, 4.4)) continue;
          trees.push({
            x: tx,
            z: tz,
            s: 0.75 + rnd() * 0.55,
            kind: TREE_KINDS[Math.floor(rnd() * TREE_KINDS.length)]
          });
        }
      }
    } else {
      flat(geos.inner, mats.lot, cx, hc - 0.16, cz, 0, true);
      let hBase = type === 'tower' ? 24 + rnd() * 30 : type === 'low' ? 4 + rnd() * 3 : 7 + rnd() * 13;
      hBase *= 1 + dens * 0.5;
      const layout = rnd();

      const addB = (x: number, z: number, w: number, d: number, h: number) => {
        const gy = heightAt(x, z);
        const catalog = cityBuildings();
        let kind: BuildingKind;
        if (type === 'tower') kind = TOWER_KINDS[Math.floor(rnd() * TOWER_KINDS.length)];
        else if (type === 'low') kind = HOUSE_KINDS[Math.floor(rnd() * HOUSE_KINDS.length)];
        else kind = MID_KINDS[Math.floor(rnd() * MID_KINDS.length)];

        if (catalog) {
          const b = catalog[kind];
          const fit = Math.min(w / b.size.w, d / b.size.d);
          const sx = fit;
          const sz = fit;
          const sy = Math.max(0.72, Math.min(1.35, h / b.size.h));
          const bw = b.size.w * sx;
          const bh = b.size.h * sy;
          const bd = b.size.d * sz;
          // Consume the same choices at every LOD so approaching a chunk never
          // regenerates a different set of buildings.
          const yaw = rnd() < 0.5 ? 0 : Math.PI;
          const farColor = PALETTE[Math.floor(rnd() * PALETTE.length)];
          boxes.push({ pos: [x, gy + bh / 2, z], half: [bw / 2, bh / 2, bd / 2] });
          if (far) {
            farBoxes.push({ w: bw, h: bh, d: bd, x, y: gy + bh / 2, z, color: farColor });
            return;
          }
          const mesh = new THREE.Mesh(b.geometry, b.material);
          mesh.position.set(x, gy, z);
          mesh.scale.set(sx, sy, sz);
          mesh.rotation.y = yaw;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          group.add(mesh);
          return;
        }

        const y = gy + h / 2 - 1.05;
        boxes.push({ pos: [x, y, z], half: [w / 2, h / 2 + 1.25, d / 2] });
        if (far) {
          farBoxes.push({ w, h: h + 2.5, d, x, y, z, color: PALETTE[Math.floor(rnd() * PALETTE.length)] });
          return;
        }
        const geo = buildingGeo(w, h + 2.5, d);
        trash.push(geo);
        const side = mats.facades[Math.floor(rnd() * mats.facades.length)];
        const mesh = new THREE.Mesh(geo, [side, side, mats.roof, mats.roof, side, side]);
        mesh.position.set(x, y, z);
        mesh.castShadow = true; mesh.receiveShadow = true;
        group.add(mesh);
      };

      if (type === 'tower' || layout < 0.3) {
        addB(cx, cz, inner * (0.55 + rnd() * 0.3), inner * (0.55 + rnd() * 0.3), hBase);
      } else if (layout < 0.65) {
        const vert = rnd() < 0.5;
        for (let k = 0; k < 2; k++) {
          const off = (k ? 1 : -1) * inner / 4;
          const hh = hBase * (0.7 + rnd() * 0.6);
          if (vert) addB(cx + off, cz, inner / 2 - 1.5, inner * (0.6 + rnd() * 0.3), hh);
          else addB(cx, cz + off, inner * (0.6 + rnd() * 0.3), inner / 2 - 1.5, hh);
        }
      } else {
        for (let k = 0; k < 4; k++) {
          addB(cx + (k % 2 ? 1 : -1) * inner / 4, cz + (k < 2 ? 1 : -1) * inner / 4, inner / 2 - 2, inner / 2 - 2, hBase * (0.6 + rnd() * 0.8));
        }
      }
      if (rnd() < 0.6) {
        const side = rnd() < 0.5 ? 1 : -1;
        for (let k = -1; k <= 1; k += 2) {
          const tx = cx + k * BLOCK * 0.22;
          const tz = cz + side * (BLOCK / 2 - 3.3);
          if (!onDriveable(seed, tx, tz, 4.2)) trees.push({ x: tx, z: tz, s: 0.62 + rnd() * 0.18, kind: 'common' });
        }
      }
      if (far && farBoxes.length) {
        const mg = mergeBoxes(farBoxes);
        trash.push(mg);
        group.add(new THREE.Mesh(mg, mats.distant));
      }
    }
  }

  // props only near the player
  if (detail && type !== 'canal') {
    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();

    if (type === 'highway') {
      const axis = highwayAxis(seed, i, j);
      if (axis && axis !== 'both') {
        const alongX = axis === 'x';
        const edge = HW_WIDTH / 2 + 4.6;
        for (const s of [-1, 1]) {
          for (let k = 0; k < 3; k++) {
            const t = (k - 1) * (BLOCK * 0.22);
            const tx = alongX ? cx + t : cx + s * edge;
            const tz = alongX ? cz + s * edge : cz + t;
            if (onDriveable(seed, tx, tz, 3.8)) continue;
            trees.push({
              x: tx,
              z: tz,
              s: 0.55 + rnd() * 0.2,
              kind: TREE_KINDS[Math.floor(rnd() * TREE_KINDS.length)]
            });
          }
        }
      }
    } else if (type === 'park' || type === 'plaza') {
      const extra = type === 'park' ? 16 : 12;
      for (let k = 0; k < extra; k++) {
        const px = cx + (rnd() * 2 - 1) * (inner / 2 - 3.4);
        const pz = cz + (rnd() * 2 - 1) * (inner / 2 - 3.4);
        const kind = GROUND_KINDS[Math.floor(rnd() * GROUND_KINDS.length)];
        const s = 0.62 + rnd() * 0.28;
        if (onDriveable(seed, px, pz, plantRadius(kind, s))) continue;
        plants.push({ x: px, z: pz, s, yaw: rnd() * Math.PI * 2, kind });
      }
    } else if (type !== 'parking' && type !== 'mall' && type !== 'works' && type !== 'avenue') {
      for (let k = 0; k < 4; k++) {
        const along = (rnd() - 0.5) * (inner - 8);
        const side = k < 2 ? 1 : -1;
        const onX = k % 2 === 0;
        const px = onX ? cx + along : cx + side * (BLOCK / 2 - 6.4);
        const pz = onX ? cz + side * (BLOCK / 2 - 6.4) : cz + along;
        const kind = KERB_KINDS[Math.floor(rnd() * KERB_KINDS.length)];
        const s = 0.55 + rnd() * 0.2;
        if (onDriveable(seed, px, pz, plantRadius(kind, s))) continue;
        plants.push({ x: px, z: pz, s, yaw: rnd() * Math.PI * 2, kind });
      }
    }

    // Validate the full crown, not only the trunk. This final guard also covers
    // trees added by plazas and building edges, plus bushes that would spill
    // onto asphalt from a sidewalk.
    for (let k = trees.length - 1; k >= 0; k--) {
      if (onDriveable(seed, trees[k].x, trees[k].z, plantRadius(trees[k].kind, trees[k].s))) {
        trees.splice(k, 1);
      }
    }
    for (let k = plants.length - 1; k >= 0; k--) {
      if (onDriveable(seed, plants[k].x, plants[k].z, plantRadius(plants[k].kind, plants[k].s))) {
        plants.splice(k, 1);
      }
    }

    const nature = cityNature();

    if (trees.length) {
      if (nature) {
        const byKind = new Map<NatureKind, typeof trees>();
        for (const t of trees) {
          const list = byKind.get(t.kind) ?? [];
          list.push(t);
          byKind.set(t.kind, list);
        }
        byKind.forEach((list, kind) => {
          const mesh = nature[kind];
          const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
          list.forEach((t, k) => {
            const ty = heightAt(t.x, t.z);
            quat.setFromAxisAngle(UP, ((hash3(seed, t.x | 0, t.z | 0) >>> 0) % 360) * 0.01745);
            scl.set(t.s, t.s, t.s);
            pos.set(t.x, ty, t.z);
            m4.compose(pos, quat, scl);
            inst.setMatrixAt(k, m4);
            boxes.push({ pos: [t.x, ty + 1.6 * t.s, t.z], half: [0.55 * t.s, 1.6 * t.s, 0.55 * t.s] });
          });
          inst.castShadow = true;
          group.add(inst);
        });
      } else {
        const trunkI = new THREE.InstancedMesh(geos.trunk, mats.trunk, trees.length);
        const leafI = new THREE.InstancedMesh(geos.leaf, mats.leaf, trees.length);
        const leafI2 = new THREE.InstancedMesh(geos.leaf, mats.leaf2, trees.length);
        trees.forEach((t, k) => {
          const ty = heightAt(t.x, t.z);
          scl.set(t.s, t.s, t.s);
          pos.set(t.x, ty + 1.2 * t.s + 0.3, t.z); m4.compose(pos, quat, scl); trunkI.setMatrixAt(k, m4);
          pos.set(t.x, ty + 3 * t.s + 0.3, t.z); m4.compose(pos, quat, scl); leafI.setMatrixAt(k, m4);
          scl.set(t.s * 0.7, t.s * 0.7, t.s * 0.7);
          pos.set(t.x + 0.6 * t.s, ty + 3.9 * t.s + 0.3, t.z - 0.3 * t.s); m4.compose(pos, quat, scl); leafI2.setMatrixAt(k, m4);
          boxes.push({ pos: [t.x, ty + 1.4 * t.s, t.z], half: [0.45 * t.s, 1.5 * t.s, 0.45 * t.s] });
        });
        trunkI.castShadow = leafI.castShadow = true;
        group.add(trunkI, leafI, leafI2);
      }
    }

    if (plants.length && nature) {
      const byKind = new Map<NatureKind, typeof plants>();
      for (const p of plants) {
        const list = byKind.get(p.kind) ?? [];
        list.push(p);
        byKind.set(p.kind, list);
      }
      byKind.forEach((list, kind) => {
        const mesh = nature[kind];
        const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
        list.forEach((p, k) => {
          quat.setFromAxisAngle(UP, p.yaw);
          scl.set(p.s, p.s, p.s);
          pos.set(p.x, heightAt(p.x, p.z), p.z);
          m4.compose(pos, quat, scl);
          inst.setMatrixAt(k, m4);
        });
        group.add(inst);
      });
    }

    const props = cityProps();

    if (lamps.length) {
      // The glTF lamp is one mesh, so a block's lamps cost a single draw call.
      const lampI = props
        ? new THREE.InstancedMesh(props.lamp.geometry, props.lamp.material, lamps.length)
        : new THREE.InstancedMesh(geos.pole, mats.pole, lamps.length);
      const bulbI = new THREE.InstancedMesh(
        props ? geos.lampBulb : geos.bulb,
        mats.bulb,
        lamps.length
      );
      const head = new THREE.Vector3();
      scl.set(1, 1, 1);
      lamps.forEach((l, k) => {
        const ly = heightAt(l.x, l.z);
        quat.setFromAxisAngle(UP, props ? l.yaw : 0);
        pos.set(l.x, props ? ly : ly + 3.1, l.z);
        m4.compose(pos, quat, scl);
        lampI.setMatrixAt(k, m4);

        // the bulb rides at the end of the arm, so it swings round with the yaw
        head.set(0, props ? LAMP_HEAD.y : 6.1, props ? LAMP_HEAD.z : 0).applyAxisAngle(UP, props ? l.yaw : 0);
        quat.identity();
        pos.set(l.x + head.x, ly + head.y, l.z + head.z);
        m4.compose(pos, quat, scl);
        bulbI.setMatrixAt(k, m4);

        const glow = new THREE.Mesh(geos.glow, mats.glow);
        glow.position.set(l.x + head.x, ly + 0.09, l.z + head.z);
        glow.rotation.x = -Math.PI / 2;
        group.add(glow);
      });
      lampI.castShadow = true;
      group.add(lampI, bulbI);
    }

    if (type !== 'parking' && type !== 'mall' && type !== 'works' && type !== 'highway') {
      const inset = BLOCK / 2 - 2.4;
      for (let k = 0; k < 4; k++) {
        const sx = k % 2 ? 1 : -1;
        const sz = k < 2 ? 1 : -1;
        const px = cx + sx * inset;
        const pz = cz + sz * inset;
        if (onDriveable(seed, px, pz, 1.6)) continue;
        flat(geos.tactile, mats.tactile, px, heightAt(px, pz) + 0.08, pz);
      }
      if (type !== 'avenue') {
        for (let k = 0; k < 3; k++) {
          const along = (rnd() - 0.5) * (inner - 8);
          const side = rnd() < 0.5 ? 1 : -1;
          const onX = rnd() < 0.5;
          const px = onX ? cx + along : cx + side * (BLOCK / 2 - 5.2);
          const pz = onX ? cz + side * (BLOCK / 2 - 5.2) : cz + along;
          if (onDriveable(seed, px, pz, 1.8)) continue;
          if (k === 0) {
            flat(geos.bin, mats.metal, px, heightAt(px, pz) + 0.45, pz);
            boxes.push({ pos: [px, heightAt(px, pz) + 0.45, pz], half: [0.28, 0.45, 0.28] });
          } else if (k === 1 && (type === 'park' || type === 'plaza' || rnd() < 0.45)) {
            const ang = onX ? 0 : Math.PI / 2;
            flat(geos.bench, mats.wood, px, heightAt(px, pz) + 0.42, pz, ang);
            flat(geos.benchBack, mats.wood, px, heightAt(px, pz) + 0.72, pz, ang);
          } else {
            const cover = new THREE.Mesh(geos.manhole, mats.metal);
            cover.rotation.x = -Math.PI / 2;
            cover.position.set(px, heightAt(px, pz) + 0.06, pz);
            group.add(cover);
          }
        }
      }
    }

    const jx = ox + CELL, jz = oz + CELL;
    const lit = type !== 'avenue' && type !== 'highway' && hasSignals(seed, jx, jz);
    if (lit) {
      const housingI = props
        ? new THREE.InstancedMesh(props.signal.geometry, props.signal.material, 4)
        : null;
      if (housingI) { housingI.castShadow = true; group.add(housingI); }
      const lens = new THREE.Vector3();
      const approaches = [
        { x: jx - (STREET / 2 + 0.9), z: jz - (STREET / 2 + 0.9), yaw: propYaw(-1, 0), axisX: true },
        { x: jx + (STREET / 2 + 0.9), z: jz - (STREET / 2 + 0.9), yaw: propYaw(1, 0), axisX: true },
        { x: jx - (STREET / 2 + 0.9), z: jz + (STREET / 2 + 0.9), yaw: propYaw(0, -1), axisX: false },
        { x: jx + (STREET / 2 + 0.9), z: jz + (STREET / 2 + 0.9), yaw: propYaw(0, 1), axisX: false }
      ];
      approaches.forEach((ap, k) => {
        const y = heightAt(ap.x, ap.z);
        let dots: THREE.Mesh[];
        if (housingI) {
          scl.set(1, 1, 1);
          quat.setFromAxisAngle(UP, ap.yaw);
          pos.set(ap.x, y, ap.z);
          m4.compose(pos, quat, scl);
          housingI.setMatrixAt(k, m4);
          dots = SIGNAL_LENS_Y.map((ly, d) => {
            lens.set(0, ly, -SIGNAL_LENS_OUT).applyAxisAngle(UP, ap.yaw);
            return flat(
              geos.signalDot,
              [mats.tlRed, mats.tlAmber, mats.tlGreen][d],
              ap.x + lens.x, y + lens.y, ap.z + lens.z, ap.yaw
            );
          });
        } else {
          flat(geos.tlPole, mats.metal, ap.x, y + 2.4, ap.z, 0, true);
          flat(geos.tlHead, mats.roof, ap.x, y + 5.0, ap.z);
          dots = [
            flat(geos.tlDot, mats.tlRed, ap.x, y + 5.3, ap.z - 0.2),
            flat(geos.tlDot, mats.tlAmber, ap.x, y + 5.0, ap.z - 0.2),
            flat(geos.tlDot, mats.tlGreen, ap.x, y + 4.7, ap.z - 0.2)
          ];
        }
        signals.push({ nx: jx, nz: jz, axisX: ap.axisX, dots });
        boxes.push({ pos: [ap.x, y + 2.4, ap.z], half: [0.22, 2.4, 0.22] });
      });
    } else if (type !== 'avenue' && type !== 'highway') {
      const stop = ((hash3(seed, i + 3, j + 11) >>> 0) % 100) < 70;
      const kind: SignKind = stop ? 'stop' : 'yield';
      const sx = cx + (BLOCK / 2 - 1.15);
      const sz = cz + (BLOCK / 2 - 1.15);
      if (!onDriveable(seed, sx, sz, 1.2)) {
        const sign = makeSign(kind);
        sign.position.set(sx, heightAt(sx, sz), sz);
        sign.rotation.y = propYaw(1, 1);
        group.add(sign);
        boxes.push({ pos: [sx, heightAt(sx, sz) + 1.2, sz], half: [0.12, 1.2, 0.12] });
      }
    }

    {
      const speedKind: SignKind = type === 'highway' ? 'speed80' : dens > 0.55 ? 'speed50' : 'speed30';
      if (rnd() < 0.55) {
        const sx = cx + (rnd() < 0.5 ? 1 : -1) * (BLOCK / 2 - 1.3);
        const sz = cz + (rnd() < 0.5 ? 1 : -1) * (inner / 2 - 2);
        if (!onDriveable(seed, sx, sz, 1.3)) {
          const sign = makeSign(speedKind);
          sign.position.set(sx, heightAt(sx, sz), sz);
          sign.rotation.y = propYaw(Math.sign(sx - cx), 0);
          group.add(sign);
          boxes.push({ pos: [sx, heightAt(sx, sz) + 1.2, sz], half: [0.12, 1.2, 0.12] });
        }
      }
    }

    const parked: { x: number; z: number; yaw: number }[] = [];
    if (type !== 'avenue' && type !== 'highway' && rnd() < 0.22) {
      const side = rnd() < 0.5 ? 1 : -1;
      const along = (rnd() - 0.5) * (BLOCK - 16);
      const kerb = BLOCK / 2 + 3.15;
      if (rnd() < 0.5) parked.push({ x: cx + along, z: cz + side * kerb, yaw: Math.PI / 2 });
      else parked.push({ x: cx + side * kerb, z: cz + along, yaw: 0 });
    }
    for (const lot of lotCars) {
      const spanA = LOT_COLS * LOT_SLOT_W;
      const spanB = LOT_ROWS * LOT_SLOT_D + LOT_AISLE;
      for (let rr = 0; rr < LOT_ROWS; rr++) {
        for (let cc = 0; cc < LOT_COLS; cc++) {
          if (rnd() < 0.28) continue;
          const a = -spanA / 2 + (cc + 0.5) * LOT_SLOT_W;
          const rowZ = rr === 0 ? -spanB / 2 + LOT_SLOT_D / 2 : spanB / 2 - LOT_SLOT_D / 2;
          const lx = lot.yaw === 0 ? lot.x + a : lot.x + rowZ;
          const lz = lot.yaw === 0 ? lot.z + rowZ : lot.z + a;
          if (Math.abs(lx - lot.x) > lot.half - 2.1 || Math.abs(lz - lot.z) > lot.half - 2.1) continue;
          const yaw = lot.yaw === 0 ? (rr === 0 ? 0 : Math.PI) : (rr === 0 ? -Math.PI / 2 : Math.PI / 2);
          parked.push({ x: lx, z: lz, yaw });
        }
      }
    }
    for (const pk of parked) {
      const kind = PARK_KINDS[Math.floor(rnd() * PARK_KINDS.length)];
      const v = cloneVehicle(kind, pickHue(kind, rnd()));
      v.position.set(pk.x, heightAt(pk.x, pk.z) + 0.35, pk.z);
      v.rotation.y = pk.yaw;
      group.add(v);
      const ex = pk.yaw === 0 ? 1.1 : 2.4;
      const ez = pk.yaw === 0 ? 2.4 : 1.1;
      boxes.push({ pos: [pk.x, heightAt(pk.x, pk.z) + 1, pk.z], half: [ex, 0.9, ez] });
    }
  }

  return {
    key: `${i},${j}`,
    i,
    j,
    lod,
    type,
    group,
    boxes,
    ground,
    signals,
    dispose: () => {
      trash.forEach((g) => g.dispose());
      group.traverse((o: any) => { if (o.isInstancedMesh) o.dispose(); });
    }
  };
}

/** Facade materials need the shared window texture, so they are built once here. */
export function ensureFacades() {
  const { mats, win } = createAssets();
  if (mats.facades.length) return;
  for (const hex of PALETTE) {
    mats.facades.push(
      new THREE.MeshLambertMaterial({
        color: hex,
        map: win.map,
        emissive: 0xffffff,
        emissiveMap: win.emissive,
        emissiveIntensity: 0
      })
    );
  }
}
