import * as THREE from 'three';
import { BLOCK, CELL, CORNER_R, HW_LANE, HW_MEDIAN, HW_SHOULDER, HW_WIDTH, LOT_COLS, LOT_ROWS, SIDEWALK, STREET } from './config';
import { mulberry32 } from './rng';

function canvas(px: number) {
  const c = document.createElement('canvas');
  c.width = px; c.height = px;
  return c;
}

function noiseFill(c: HTMLCanvasElement, base: string, amp: number) {
  const g = c.getContext('2d')!;
  g.fillStyle = base; g.fillRect(0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let k = 0; k < d.length; k += 4) {
    const n = ((Math.random() * amp * 2 - amp) | 0);
    d[k] += n; d[k + 1] += n; d[k + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return g;
}

function finish(c: HTMLCanvasElement, wrap = false, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

let puff: string | null = null;
/**
 * Soft round puff used by the cloud billboards. Drawn here as a data URL so the
 * sky never blocks on a network fetch for it.
 */
export function cloudPuffUrl() {
  if (puff) return puff;
  const px = 128, c = canvas(px);
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(px / 2, px / 2, px * 0.03, px / 2, px / 2, px * 0.48);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.82)');
  grd.addColorStop(0.78, 'rgba(255,255,255,0.3)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, px, px);
  puff = c.toDataURL();
  return puff;
}

/** One cell of asphalt: block platform in the middle, lane markings and zebras at the edges. */
function tileTexture(plain: boolean) {
  const px = 1024, s = px / CELL;
  const c = canvas(px);
  const g = noiseFill(c, '#41464f', 7);
  const a = (STREET / 2) * s, b = (CELL - STREET / 2) * s;
  // Cool, low-contrast damp patches break the uniformly dry asphalt. Their
  // stronger specular response comes from the matching roughness map below.
  const wet = mulberry32(8301);
  for (let k = 0; k < 34; k++) {
    const x = wet() * px;
    const y = wet() * px;
    const r = (18 + wet() * 68) * s;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(25,35,45,${0.04 + wet() * 0.07})`);
    grd.addColorStop(1, 'rgba(25,35,45,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  if (!plain) {
    g.fillStyle = '#8f8a82'; g.fillRect(a - 0.9 * s, a - 0.9 * s, b - a + 1.8 * s, b - a + 1.8 * s);
    g.fillStyle = '#b9b6ae'; g.fillRect(a, a, b - a, b - a);
  }
  // Centreline. A cell only paints its two low edges, a half-open interval, so
  // neighbouring cells never lay a second line over the same stretch of road.
  // Each dash run also stops at the junction box, which is what used to leave a
  // yellow cross painted across the middle of every intersection.
  const lane = 0.32 * s, dash = 3 * s;
  g.fillStyle = '#e6d28e';
  for (let d = a; d < b; d += dash * 2) {
    const run = Math.min(dash, b - d);
    g.fillRect(d, 0, run, lane);
    g.fillRect(0, d, lane, run);
  }

  // Zebras. Four cells meet at every junction and each paints the half of the
  // crossing that lands inside its own square, so the four approaches come out
  // whole and drawn exactly once.
  g.fillStyle = '#dedcd4';
  const stripe = 0.85 * s, gap = 0.75 * s, len = 2.4 * s;
  for (const [jx, jz] of [[0, 0], [px, 0], [0, px], [px, px]]) {
    for (let m = -a + gap; m < a - gap; m += stripe + gap) {
      g.fillRect(jx + m, jz - a - len, stripe, len);
      g.fillRect(jx + m, jz + a, stripe, len);
      g.fillRect(jx - a - len, jz + m, len, stripe);
      g.fillRect(jx + a, jz + m, len, stripe);
    }
  }
  return finish(c);
}

/** Greyscale roughness: damp asphalt is glossy, while sidewalks stay matte. */
function roadRoughnessTexture(plain: boolean) {
  const px = 512, s = px / CELL;
  const c = canvas(px);
  const g = c.getContext('2d')!;
  g.fillStyle = '#5d5d5d';
  g.fillRect(0, 0, px, px);
  const rnd = mulberry32(9147);
  for (let k = 0; k < 46; k++) {
    const x = rnd() * px;
    const y = rnd() * px;
    const rx = 8 + rnd() * 42;
    const ry = 20 + rnd() * 80;
    const grd = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    const v = 30 + Math.floor(rnd() * 35);
    grd.addColorStop(0, `rgb(${v},${v},${v})`);
    grd.addColorStop(1, 'rgba(105,105,105,0)');
    g.fillStyle = grd;
    g.fillRect(x - rx, y - ry, rx * 2, ry * 2);
  }
  if (!plain) {
    const a = (STREET / 2) * s, b = (CELL - STREET / 2) * s;
    g.fillStyle = '#d8d8d8';
    g.fillRect(a, a, b - a, b - a);
  }
  const t = finish(c, false, 4);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Tiny asphalt grain catches long highlights without looking mirror-polished. */
function asphaltNormalTexture() {
  const px = 256;
  const c = canvas(px);
  const g = c.getContext('2d')!;
  const image = g.createImageData(px, px);
  const rnd = mulberry32(7712);
  for (let k = 0; k < image.data.length; k += 4) {
    image.data[k] = 122 + Math.floor(rnd() * 12);
    image.data[k + 1] = 122 + Math.floor(rnd() * 12);
    image.data[k + 2] = 250;
    image.data[k + 3] = 255;
  }
  g.putImageData(image, 0, 0);
  const t = finish(c, true, 4);
  t.colorSpace = THREE.NoColorSpace;
  t.repeat.set(7, 7);
  return t;
}

function stripTexture() {
  const px = 256;
  const c = canvas(px);
  const g = noiseFill(c, '#3f444d', 7);
  g.strokeStyle = '#e6d28e'; g.lineWidth = 6; g.setLineDash([22, 22]);
  g.beginPath(); g.moveTo(px / 2, 0); g.lineTo(px / 2, px); g.stroke();
  g.setLineDash([]); g.strokeStyle = '#d9d7cf'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(8, 0); g.lineTo(8, px); g.moveTo(px - 8, 0); g.lineTo(px - 8, px); g.stroke();
  return finish(c, true);
}

function dashRun(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, on: number, off: number, thick: number) {
  g.lineWidth = thick;
  g.setLineDash([on, off]);
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.setLineDash([]);
}

/** Four-lane carriageway painted through the block, with city streets still on the edges. */
function highwayTexture(axis: 'x' | 'z' | 'both') {
  const px = 1024, s = px / CELL;
  const c = canvas(px);
  const g = noiseFill(c, '#41464f', 6);
  const a = (STREET / 2) * s, b = (CELL - STREET / 2) * s;
  g.fillStyle = '#7d9a5c';
  g.fillRect(a, a, b - a, b - a);

  const paintBand = (horizontal: boolean) => {
    const mid = px / 2;
    const half = (HW_WIDTH / 2) * s;
    const lane = HW_LANE * s;
    const med = HW_MEDIAN * s;
    const rumble = HW_SHOULDER * 0.35 * s;
    if (horizontal) {
      g.fillStyle = '#3a4049';
      g.fillRect(0, mid - half, px, half * 2);
      g.fillStyle = '#5a4038';
      g.fillRect(0, mid - half, px, rumble);
      g.fillRect(0, mid + half - rumble, px, rumble);
      if (axis !== 'both') {
        g.fillStyle = '#6a8a52';
        g.fillRect(a, mid - med / 2, b - a, med);
      }
      g.fillStyle = '#e6d28e';
      g.fillRect(0, mid - med / 2 - 2.5, px, 3);
      g.fillRect(0, mid + med / 2 - 0.5, px, 3);
      g.strokeStyle = '#e8e6de';
      dashRun(g, 0, mid - med / 2 - lane, px, mid - med / 2 - lane, 14, 16, 3);
      dashRun(g, 0, mid + med / 2 + lane, px, mid + med / 2 + lane, 14, 16, 3);
      g.strokeStyle = '#d9d7cf';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(0, mid - half + rumble + 2);
      g.lineTo(px, mid - half + rumble + 2);
      g.moveTo(0, mid + half - rumble - 2);
      g.lineTo(px, mid + half - rumble - 2);
      g.stroke();
    } else {
      g.fillStyle = '#3a4049';
      g.fillRect(mid - half, 0, half * 2, px);
      g.fillStyle = '#5a4038';
      g.fillRect(mid - half, 0, rumble, px);
      g.fillRect(mid + half - rumble, 0, rumble, px);
      if (axis !== 'both') {
        g.fillStyle = '#6a8a52';
        g.fillRect(mid - med / 2, a, med, b - a);
      }
      g.fillStyle = '#e6d28e';
      g.fillRect(mid - med / 2 - 2.5, 0, 3, px);
      g.fillRect(mid + med / 2 - 0.5, 0, 3, px);
      g.strokeStyle = '#e8e6de';
      dashRun(g, mid - med / 2 - lane, 0, mid - med / 2 - lane, px, 14, 16, 3);
      dashRun(g, mid + med / 2 + lane, 0, mid + med / 2 + lane, px, 14, 16, 3);
      g.strokeStyle = '#d9d7cf';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(mid - half + rumble + 2, 0);
      g.lineTo(mid - half + rumble + 2, px);
      g.moveTo(mid + half - rumble - 2, 0);
      g.lineTo(mid + half - rumble - 2, px);
      g.stroke();
    }
  };

  if (axis === 'x' || axis === 'both') paintBand(true);
  if (axis === 'z' || axis === 'both') paintBand(false);

  if (axis === 'both') {
    const mid = px / 2;
    const half = (HW_WIDTH / 2) * s;
    g.fillStyle = '#3a4049';
    g.fillRect(mid - half, mid - half, half * 2, half * 2);
  }

  g.fillStyle = '#e6d28e';
  const lane = 0.32 * s, dash = 3 * s;
  for (let d = a; d < b; d += dash * 2) {
    const run = Math.min(dash, b - d);
    g.fillRect(d, 0, run, lane);
    g.fillRect(0, d, lane, run);
  }
  g.fillStyle = '#dedcd4';
  const stripe = 0.85 * s, gap = 0.75 * s, len = 2.4 * s;
  for (const [jx, jz] of [[0, 0], [px, 0], [0, px], [px, px]] as const) {
    for (let m = -a + gap; m < a - gap; m += stripe + gap) {
      g.fillRect(jx + m, jz - a - len, stripe, len);
      g.fillRect(jx + m, jz + a, stripe, len);
      g.fillRect(jx - a - len, jz + m, len, stripe);
      g.fillRect(jx + a, jz + m, len, stripe);
    }
  }
  return finish(c);
}

function lotTexture() {
  const px = 512;
  const c = canvas(px);
  const g = noiseFill(c, '#3a3f47', 6);
  const pad = 28;
  const aisle = 78;
  const rowH = (px - pad * 2 - aisle) / LOT_ROWS;
  const slotW = (px - pad * 2) / LOT_COLS;
  g.strokeStyle = '#dcd9cf';
  g.lineWidth = 4;
  for (let r = 0; r < LOT_ROWS; r++) {
    const y0 = pad + r * (rowH + aisle);
    g.strokeRect(pad, y0, px - pad * 2, rowH);
    for (let k = 1; k < LOT_COLS; k++) {
      g.beginPath();
      g.moveTo(pad + k * slotW, y0 + 6);
      g.lineTo(pad + k * slotW, y0 + rowH - 6);
      g.stroke();
    }
  }
  return finish(c);
}

function sidewalkTexture() {
  const px = 512;
  const c = canvas(px);
  const g = noiseFill(c, '#c4c1b8', 8);
  g.strokeStyle = 'rgba(90,86,78,0.22)';
  g.lineWidth = 2;
  const step = px / 8;
  for (let k = 0; k <= 8; k++) {
    g.beginPath(); g.moveTo(k * step, 0); g.lineTo(k * step, px); g.stroke();
    g.beginPath(); g.moveTo(0, k * step); g.lineTo(px, k * step); g.stroke();
  }
  g.fillStyle = 'rgba(70,68,62,0.35)';
  g.beginPath(); g.arc(px * 0.28, px * 0.62, 11, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(px * 0.74, px * 0.3, 11, 0, Math.PI * 2); g.fill();
  return finish(c, true, 6);
}

/** Ground slab with rounded corners so manzanas are not hard 90° blocks. */
export function roundedSlab(w: number, h: number, d: number, r = CORNER_R) {
  const hw = w / 2, hd = d / 2;
  const rr = Math.min(r, hw - 0.08, hd - 0.08);
  const s = new THREE.Shape();
  s.moveTo(-hw + rr, -hd);
  s.lineTo(hw - rr, -hd);
  s.absarc(hw - rr, -hd + rr, rr, -Math.PI / 2, 0, false);
  s.lineTo(hw, hd - rr);
  s.absarc(hw - rr, hd - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(-hw + rr, hd);
  s.absarc(-hw + rr, hd - rr, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(-hw, -hd + rr);
  s.absarc(-hw + rr, -hd + rr, rr, Math.PI, Math.PI * 1.5, false);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 7 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, h / 2, 0);
  g.computeVertexNormals();
  return g;
}

/** Facade: colour map plus an emissive map so windows light up at night. */
function windowTextures() {
  const n = 4, px = 256, cell = px / n;
  const c = canvas(px), e = canvas(px);
  const g = c.getContext('2d')!, ge = e.getContext('2d')!;
  g.fillStyle = '#f4f3ef'; g.fillRect(0, 0, px, px);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, px, px);
  const rnd = mulberry32(99);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i * cell, y = j * cell, lit = rnd() < 0.42;
      g.fillStyle = '#d9d6cf'; g.fillRect(x, y + cell - 4, cell, 4);
      g.fillStyle = '#2f3b4a'; g.fillRect(x + 10, y + 8, cell - 20, cell - 24);
      g.fillStyle = 'rgba(180,200,220,0.45)';
      g.beginPath(); g.moveTo(x + 10, y + 8); g.lineTo(x + cell - 10, y + 8); g.lineTo(x + cell - 10, y + 22); g.closePath(); g.fill();
      g.fillStyle = '#f4f3ef'; g.fillRect(x + cell / 2 - 1.5, y + 8, 3, cell - 24);
      if (lit) {
        ge.fillStyle = rnd() < 0.5 ? '#ffd58a' : '#cfe3ff';
        ge.fillRect(x + 10, y + 8, cell - 20, cell - 24);
        ge.fillStyle = '#000'; ge.fillRect(x + cell / 2 - 1.5, y + 8, 3, cell - 24);
      }
    }
  }
  return { map: finish(c, true, 4), emissive: finish(e, true, 4) };
}

function glowTexture() {
  const px = 128;
  const c = canvas(px);
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(px / 2, px / 2, 2, px / 2, px / 2, px / 2);
  grd.addColorStop(0, 'rgba(255,232,170,0.95)');
  grd.addColorStop(0.45, 'rgba(255,220,140,0.35)');
  grd.addColorStop(1, 'rgba(255,210,120,0)');
  g.fillStyle = grd; g.fillRect(0, 0, px, px);
  return finish(c, false, 2);
}

/** Cheap equirectangular environment so car paint has something to reflect. */
function envTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, '#dfeaf6'); grd.addColorStop(0.46, '#9fb6cd');
  grd.addColorStop(0.54, '#5b6470'); grd.addColorStop(1, '#2b3038');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 64);
  g.fillStyle = 'rgba(255,250,230,0.9)';
  g.beginPath(); g.arc(34, 16, 9, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let cached: any = null;

export function createAssets() {
  if (cached) return cached as Assets;

  const win = windowTextures();
  const env = envTexture();
  const roadRoughness = roadRoughnessTexture(false);
  const asphaltNormal = asphaltNormalTexture();

  const roadMat = (map: THREE.Texture, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({
      map,
      roughness: 0.9,
      metalness: 0.04,
      normalMap: asphaltNormal,
      normalScale: new THREE.Vector2(0.1, 0.1),
      ...extra
    });

  const mats = {
    tile: roadMat(tileTexture(false), { roughnessMap: roadRoughness }),
    strip: roadMat(stripTexture(), {
      roughness: 0.82,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    }),
    hwyX: roadMat(highwayTexture('x')),
    hwyZ: roadMat(highwayTexture('z')),
    hwyBoth: roadMat(highwayTexture('both')),
    jersey: new THREE.MeshLambertMaterial({ color: 0xc5c7c2 }),
    lotFloor: new THREE.MeshLambertMaterial({ map: lotTexture() }),
    sidewalk: new THREE.MeshLambertMaterial({ map: sidewalkTexture(), color: 0xc4c1b8 }),
    curb: new THREE.MeshLambertMaterial({ color: 0x8b877f }),
    under: new THREE.MeshLambertMaterial({ color: 0x16181c }),
    tactile: new THREE.MeshLambertMaterial({ color: 0xc9b48a }),
    grass: new THREE.MeshLambertMaterial({ color: 0x5f9450 }),
    plaza: new THREE.MeshLambertMaterial({ color: 0xd2c7b0 }),
    lot: new THREE.MeshLambertMaterial({ color: 0x9d978c }),
    stone: new THREE.MeshLambertMaterial({ color: 0xa19b91 }),
    roof: new THREE.MeshLambertMaterial({ color: 0x5c606a }),
    hvac: new THREE.MeshLambertMaterial({ color: 0x8e939c }),
    trunk: new THREE.MeshLambertMaterial({ color: 0x5b4231 }),
    leaf: new THREE.MeshLambertMaterial({ color: 0x3f7e3c }),
    leaf2: new THREE.MeshLambertMaterial({ color: 0x5a9a48 }),
    pole: new THREE.MeshLambertMaterial({ color: 0x737b88 }),
    bulb: new THREE.MeshLambertMaterial({ color: 0xfff3b8, emissive: 0xffd77a, emissiveIntensity: 0.3 }),
    water: new THREE.MeshLambertMaterial({ color: 0x1d5f8f }),
    deck: new THREE.MeshLambertMaterial({ color: 0x585d66 }),
    rail: new THREE.MeshLambertMaterial({ color: 0xc9ccd2 }),
    hedge: new THREE.MeshLambertMaterial({ color: 0x3d6f37 }),
    wood: new THREE.MeshLambertMaterial({ color: 0x8a6440 }),
    metal: new THREE.MeshLambertMaterial({ color: 0x6c737e }),
    mallWall: new THREE.MeshLambertMaterial({ color: 0xd8cfc2 }),
    mallBand: new THREE.MeshLambertMaterial({ color: 0x2f6ba8 }),
    mallGlass: new THREE.MeshLambertMaterial({ color: 0x3c4c5e, emissive: 0xffe6a8, emissiveIntensity: 0 }),
    sign: new THREE.MeshLambertMaterial({ color: 0xe8613c, emissive: 0xe8613c, emissiveIntensity: 0.15 }),
    glow: new THREE.MeshBasicMaterial({
      map: glowTexture(), transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false
    }),
    tlRed: new THREE.MeshLambertMaterial({ color: 0x5a1a14, emissive: 0xff3b22, emissiveIntensity: 0.9 }),
    tlAmber: new THREE.MeshLambertMaterial({ color: 0x4a3208, emissive: 0xffb020, emissiveIntensity: 0.9 }),
    tlGreen: new THREE.MeshLambertMaterial({ color: 0x0f451b, emissive: 0x25ff4f, emissiveIntensity: 1.15 }),
    facades: [] as THREE.MeshLambertMaterial[],
    merged: new THREE.MeshLambertMaterial({
      map: win.map, vertexColors: true, emissive: 0xffffff, emissiveMap: win.emissive, emissiveIntensity: 0
    }),
    // Distant buildings are neutral silhouettes, not fake grids of glowing
    // windows that vanish when the detailed library model streams in.
    distant: new THREE.MeshLambertMaterial({ vertexColors: true })
  };

  const geos = {
    curb: roundedSlab(BLOCK + 1.2, 2.2, BLOCK + 1.2, CORNER_R + 0.4),
    sidewalk: roundedSlab(BLOCK, 2.6, BLOCK, CORNER_R),
    inner: roundedSlab(BLOCK - SIDEWALK * 2, 1.15, BLOCK - SIDEWALK * 2, Math.max(1.2, CORNER_R - 1.6)),
    skirt: new THREE.BoxGeometry(BLOCK + 0.6, 4.4, BLOCK + 0.6),
    manhole: new THREE.CircleGeometry(0.38, 16),
    tactile: new THREE.BoxGeometry(1.6, 0.06, 1.6),
    trunk: new THREE.CylinderGeometry(0.22, 0.34, 2.4, 6),
    leaf: new THREE.SphereGeometry(1.6, 9, 7),
    pole: new THREE.CylinderGeometry(0.11, 0.16, 5.6, 6),
    bulb: new THREE.SphereGeometry(0.36, 8, 6),
    // the glTF lamp's luminaire is small, so its glowing lens is too
    lampBulb: new THREE.SphereGeometry(0.18, 8, 6),
    hvac: new THREE.BoxGeometry(2, 1, 1.4),
    basin: new THREE.CylinderGeometry(5, 5.4, 1, 24),
    fountain: new THREE.CylinderGeometry(4.4, 4.4, 0.3, 24),
    jet: new THREE.CylinderGeometry(0.5, 1.2, 3.4, 12),
    railX: new THREE.BoxGeometry(BLOCK, 1, 0.25),
    railZ: new THREE.BoxGeometry(0.25, 1, BLOCK),
    quayX: new THREE.BoxGeometry(BLOCK + 1.4, 4.4, 0.7),
    quayZ: new THREE.BoxGeometry(0.7, 4.4, BLOCK + 1.4),
    lake: new THREE.PlaneGeometry(BLOCK + 0.6, BLOCK + 0.6),
    glow: new THREE.PlaneGeometry(9, 9),
    lotWallX: new THREE.BoxGeometry(BLOCK - SIDEWALK * 2, 0.7, 0.5),
    lotWallZ: new THREE.BoxGeometry(0.5, 0.7, BLOCK - SIDEWALK * 2),
    lotPole: new THREE.CylinderGeometry(0.14, 0.18, 7, 6),
    lotHead: new THREE.BoxGeometry(1.5, 0.3, 0.7),
    mallSign: new THREE.BoxGeometry(6, 1.5, 0.4),
    tlPole: new THREE.CylinderGeometry(0.09, 0.12, 4.8, 6),
    tlHead: new THREE.BoxGeometry(0.34, 0.95, 0.3),
    tlDot: new THREE.CircleGeometry(0.1, 16).rotateY(Math.PI),
    // Round emissive discs sit over the authored circular lenses.
    signalDot: new THREE.CircleGeometry(0.15, 20).rotateY(Math.PI),
    bench: new THREE.BoxGeometry(1.7, 0.16, 0.55),
    benchBack: new THREE.BoxGeometry(1.7, 0.5, 0.12),
    bin: new THREE.CylinderGeometry(0.3, 0.26, 0.9, 8),
    hedgeX: new THREE.BoxGeometry(BLOCK - SIDEWALK * 2, 0.85, 0.7),
    hedgeZ: new THREE.BoxGeometry(0.7, 0.85, BLOCK - SIDEWALK * 2)
  };

  cached = { mats, geos, win, env };
  return cached as Assets;
}

type Assets = {
  mats: {
    [k: string]: any;
    facades: THREE.MeshLambertMaterial[];
    merged: THREE.MeshLambertMaterial;
    distant: THREE.MeshLambertMaterial;
    glow: THREE.MeshBasicMaterial;
  };
  geos: { [k: string]: THREE.BufferGeometry };
  win: { map: THREE.Texture; emissive: THREE.Texture };
  env: THREE.Texture;
};
export type CityAssets = Assets;

/** Per-face UV scaling so window tiles keep a constant real-world size. */
export function buildingGeo(w: number, h: number, d: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  for (let k = 0; k < 24; k++) {
    const face = Math.floor(k / 4);
    let su = 1, sv = 1;
    if (face === 0 || face === 1) { su = d / 12; sv = h / 12; }
    else if (face === 4 || face === 5) { su = w / 12; sv = h / 12; }
    uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv);
  }
  return g;
}

/** Distant blocks collapse into one mesh with per-vertex colour: 1 draw call instead of 12. */
export function mergeBoxes(list: { w: number; h: number; d: number; x: number; y: number; z: number; color: number }[]) {
  const subs = list.map((it) => {
    const g = buildingGeo(it.w, it.h, it.d).toNonIndexed();
    g.translate(it.x, it.y, it.z);
    return { g, c: new THREE.Color(it.color) };
  });
  const total = subs.reduce((n, s) => n + s.g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const col = new Float32Array(total * 3);
  let off = 0;
  for (const s of subs) {
    const a = s.g.attributes;
    const n = a.position.count;
    pos.set(a.position.array as Float32Array, off * 3);
    nor.set(a.normal.array as Float32Array, off * 3);
    uv.set(a.uv.array as Float32Array, off * 2);
    for (let q = 0; q < n; q++) {
      col[(off + q) * 3] = s.c.r; col[(off + q) * 3 + 1] = s.c.g; col[(off + q) * 3 + 2] = s.c.b;
    }
    off += n;
    s.g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
