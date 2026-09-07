import * as THREE from 'three';
import { BLOCK, CELL, PALETTE, SIDEWALK, STREET } from './config';
import { hash3, heightAt, mulberry32 } from './rng';
import { buildingGeo, createAssets, mergeBoxes } from './textures';
import { cityProps, LAMP_HEAD, propYaw, SIGNAL_LENS_OUT, SIGNAL_LENS_Y } from './props';
import { cityNature, GROUND_KINDS, NatureKind, TREE_KINDS } from './nature';
import { cityBuildings, HOUSE_KINDS, MID_KINDS, TOWER_KINDS, BuildingKind } from './buildings';
import { cloneVehicle, pickHue, VehicleKind } from './vehicles';

const UP = new THREE.Vector3(0, 1, 0);

export type BlockType = 'canal' | 'avenue' | 'mall' | 'parking' | 'tower' | 'build' | 'park' | 'plaza' | 'low';

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

export function blockTypeAt(seed: number, i: number, j: number): BlockType {
  const rnd = mulberry32(hash3(seed, i, j));
  const dens = district(seed, i, j);
  const r = rnd();
  if (isCanalCol(seed, i) || isCanalRow(seed, j)) return 'canal';
  if (isAveA(seed, i, j) || isAveB(seed, i, j)) return 'avenue';
  if (r < 0.06 && dens < 0.62) return 'mall';
  if (r < 0.14 && dens < 0.72) return 'parking';
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

  if (type === 'canal') {
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
    // All four streets must be in the trimesh. Using only the first strip left
    // the other three as decoration, and the car fell through them into the basin.
    ground = mergePatches(strips);
    trash.push(ground);
    const qz1 = oz + STREET / 2, qz2 = oz + CELL - STREET / 2;
    const qx1 = ox + STREET / 2, qx2 = ox + CELL - STREET / 2;
    flat(geos.quayX, mats.deck, cx, heightAt(cx, qz1) - 2.1, qz1);
    flat(geos.quayX, mats.deck, cx, heightAt(cx, qz2) - 2.1, qz2);
    flat(geos.quayZ, mats.deck, qx1, heightAt(qx1, cz) - 2.1, cz);
    flat(geos.quayZ, mats.deck, qx2, heightAt(qx2, cz) - 2.1, cz);
    const lake = new THREE.Mesh(geos.lake, mats.water);
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(cx, hc - 2.9, cz);
    group.add(lake);
    flat(geos.railX, mats.rail, cx, heightAt(cx, qz1) + 0.6, qz1);
    flat(geos.railX, mats.rail, cx, heightAt(cx, qz2) + 0.6, qz2);
    flat(geos.railZ, mats.rail, qx1, heightAt(qx1, cz) + 0.6, cz);
    flat(geos.railZ, mats.rail, qx2, heightAt(qx2, cz) + 0.6, cz);

    // Quay walls sit on the water side of the kerb so a car hugging the rail
    // never starts its wheel rays inside a volume. The old basin cube stuck
    // 1.4 m above the street and killed contact as soon as the hull clipped it.
    const wall = 0.4;
    const wallY = 0.9;
    boxes.push({ pos: [cx, hc + 0.1, cz - BLOCK / 2 + wall], half: [BLOCK / 2, wallY, wall] });
    boxes.push({ pos: [cx, hc + 0.1, cz + BLOCK / 2 - wall], half: [BLOCK / 2, wallY, wall] });
    boxes.push({ pos: [cx - BLOCK / 2 + wall, hc + 0.1, cz], half: [wall, wallY, BLOCK / 2] });
    boxes.push({ pos: [cx + BLOCK / 2 - wall, hc + 0.1, cz], half: [wall, wallY, BLOCK / 2] });
    // If something does go over, land on the water instead of the void.
    boxes.push({ pos: [cx, hc - 2.2, cz], half: [BLOCK / 2 - 0.9, 0.7, BLOCK / 2 - 0.9] });
  } else {
    const tg = patch(cx, cz, CELL, CELL, 0, segs, segs, 0);
    trash.push(tg);
    ground = tg;
    const tile = new THREE.Mesh(tg, type === 'avenue' ? mats.tilePlain : mats.tile);
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
    const nearAve = (x: number, z: number, margin: number) => {
      const a = isAveA(seed, i, j) && Math.abs(x - cx + (z - cz)) / 1.4142 < STREET / 2 + margin;
      const b = isAveB(seed, i, j) && Math.abs(x - cx - (z - cz)) / 1.4142 < STREET / 2 + margin;
      return a || b;
    };
    for (const yaw of yaws) {
      const sg = patch(cx, cz, STREET, CELL * 1.4142 + 1, yaw, 2, segs + 4, 0.2);
      trash.push(sg);
      const m = new THREE.Mesh(sg, mats.strip);
      m.receiveShadow = true;
      group.add(m);
    }
    let tries = 0;
    const want = 8 + Math.floor(rnd() * 6);
    while (trees.length < want && tries < 60) {
      tries++;
      const tx = cx + (rnd() * 2 - 1) * (BLOCK / 2 - 2);
      const tz = cz + (rnd() * 2 - 1) * (BLOCK / 2 - 2);
      if (!nearAve(tx, tz, 3.2)) trees.push({ x: tx, z: tz, s: 0.8 + rnd() * 0.6, kind: TREE_KINDS[Math.floor(rnd() * TREE_KINDS.length)] });
    }
  } else if (type === 'parking' || type === 'mall') {
    const half = inner / 2;
    flat(geos.inner, mats.lotFloor, cx, hc - 0.16, cz, 0, true);
    boxes.push({ pos: [cx, hc + 0.04, cz], half: [half, 0.4, half] });
    if (type === 'parking') {
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
  } else if (type !== 'canal') {
    if (!far) flat(geos.curb, mats.curb, cx, hc - 0.23, cz);
    flat(geos.sidewalk, mats.sidewalk, cx, hc - 0.2, cz, 0, true);
    boxes.push({ pos: [cx, hc - 0.2, cz], half: [BLOCK / 2, 0.5, BLOCK / 2] });

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
          trees.push({ x: cx + (k % 2 ? 1 : -1) * (inner / 2 - 2), z: cz + (k < 2 ? 1 : -1) * (inner / 2 - 2), s: 1.1, kind: TREE_KINDS[k % TREE_KINDS.length] });
        }
      } else {
        const count = 7 + Math.floor(rnd() * 7);
        for (let k = 0; k < count; k++) {
          trees.push({
            x: cx + (rnd() * 2 - 1) * (inner / 2 - 2.5),
            z: cz + (rnd() * 2 - 1) * (inner / 2 - 2.5),
            s: 0.8 + rnd() * 0.9,
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
          boxes.push({ pos: [x, gy + bh / 2, z], half: [bw / 2, bh / 2, bd / 2] });
          if (far) {
            farBoxes.push({ w: bw, h: bh, d: bd, x, y: gy + bh / 2, z, color: PALETTE[Math.floor(rnd() * PALETTE.length)] });
            return;
          }
          const mesh = new THREE.Mesh(b.geometry, b.material);
          mesh.position.set(x, gy, z);
          mesh.scale.set(sx, sy, sz);
          mesh.rotation.y = rnd() < 0.5 ? 0 : Math.PI;
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
          trees.push({ x: cx + k * BLOCK * 0.25, z: cz + side * (BLOCK / 2 - 1.6), s: 0.75 + rnd() * 0.25, kind: 'common' });
        }
      }
      if (far && farBoxes.length) {
        const mg = mergeBoxes(farBoxes);
        trash.push(mg);
        group.add(new THREE.Mesh(mg, mats.merged));
      }
    }
  }

  // props only near the player
  if (detail && type !== 'canal') {
    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();

    if (type !== 'parking' && type !== 'mall') {
      const extra = type === 'park' ? 16 : type === 'plaza' ? 12 : type === 'avenue' ? 8 : 6;
      for (let k = 0; k < extra; k++) {
        const px = cx + (rnd() * 2 - 1) * (inner / 2 - 1.6);
        const pz = cz + (rnd() * 2 - 1) * (inner / 2 - 1.6);
        if (type === 'avenue') {
          const a = isAveA(seed, i, j) && Math.abs(px - cx + (pz - cz)) / 1.4142 < STREET / 2 + 2.4;
          const b = isAveB(seed, i, j) && Math.abs(px - cx - (pz - cz)) / 1.4142 < STREET / 2 + 2.4;
          if (a || b) continue;
        }
        plants.push({
          x: px,
          z: pz,
          s: 0.75 + rnd() * 0.5,
          yaw: rnd() * Math.PI * 2,
          kind: GROUND_KINDS[Math.floor(rnd() * GROUND_KINDS.length)]
        });
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

    if (type !== 'avenue') {
      const housingI = props
        ? new THREE.InstancedMesh(props.signal.geometry, props.signal.material, 4)
        : null;
      if (housingI) { housingI.castShadow = true; group.add(housingI); }
      const lens = new THREE.Vector3();
      for (let k = 0; k < 4; k++) {
        const sgn = k % 2 ? 1 : -1;
        const sgn2 = k < 2 ? 1 : -1;
        const nodeX = ox + (sgn > 0 ? CELL : 0);
        const nodeZ = oz + (sgn2 > 0 ? CELL : 0);
        // Sit on the sidewalk, 0.9 m in from the kerb, so a turning jeep
        // does not clip the pole in the roadway.
        const tlx = cx + sgn * (BLOCK / 2 - 0.9);
        const tlz = cz + sgn2 * (BLOCK / 2 - 0.9);
        const y = heightAt(tlx, tlz);
        // face away from the block, towards the traffic this signal governs
        const yaw = k < 2 ? propYaw(sgn, 0) : propYaw(0, sgn2);

        let dots: THREE.Mesh[];
        if (housingI) {
          scl.set(1, 1, 1);
          quat.setFromAxisAngle(UP, yaw);
          pos.set(tlx, y, tlz);
          m4.compose(pos, quat, scl);
          housingI.setMatrixAt(k, m4);
          dots = SIGNAL_LENS_Y.map((ly, d) => {
            lens.set(0, ly, -SIGNAL_LENS_OUT).applyAxisAngle(UP, yaw);
            return flat(
              geos.signalDot,
              [mats.tlRed, mats.tlAmber, mats.tlGreen][d],
              tlx + lens.x, y + lens.y, tlz + lens.z, yaw
            );
          });
        } else {
          flat(geos.tlPole, mats.metal, tlx, y + 2.4, tlz, 0, true);
          flat(geos.tlHead, mats.roof, tlx, y + 5.0, tlz);
          dots = [
            flat(geos.tlDot, mats.tlRed, tlx, y + 5.3, tlz - 0.2),
            flat(geos.tlDot, mats.tlAmber, tlx, y + 5.0, tlz - 0.2),
            flat(geos.tlDot, mats.tlGreen, tlx, y + 4.7, tlz - 0.2)
          ];
        }
        signals.push({ nx: nodeX, nz: nodeZ, axisX: k < 2, dots });
        boxes.push({ pos: [tlx, y + 2.4, tlz], half: [0.22, 2.4, 0.22] });
      }
    }

    // parked cars: a few on the kerb, the rest inside lots
    const parked: { x: number; z: number; yaw: number }[] = [];
    if (type !== 'avenue') {
      const sides = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      for (const s of sides) {
        if (rnd() < 0.82) continue;
        const along = (rnd() - 0.5) * (BLOCK - 14);
        const lane = BLOCK / 2 + 3.4;
        if (s[0] === 0) parked.push({ x: cx + along, z: cz + s[1] * lane, yaw: Math.PI / 2 });
        else parked.push({ x: cx + s[0] * lane, z: cz + along, yaw: 0 });
      }
    }
    for (const lot of lotCars) {
      const rows = 2;
      const per = Math.ceil(lot.n / rows);
      for (let q = 0; q < lot.n; q++) {
        const rr = Math.floor(q / per), cc = q % per;
        const offA = (cc - (per - 1) / 2) * 2.7;
        const offB = (rr - (rows - 1) / 2) * 5.6;
        const lx = lot.yaw === 0 ? lot.x + offA : lot.x + offB;
        const lz = lot.yaw === 0 ? lot.z + offB : lot.z + offA;
        if (Math.abs(lx - lot.x) > lot.half - 2.4 || Math.abs(lz - lot.z) > lot.half - 2.4) continue;
        if (rnd() < 0.2) continue;
        parked.push({ x: lx, z: lz, yaw: lot.yaw });
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
