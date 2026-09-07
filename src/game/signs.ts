import * as THREE from 'three';

function face(draw: (g: CanvasRenderingContext2D, px: number) => void) {
  const px = 128;
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  const g = c.getContext('2d')!;
  draw(g, px);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const stopMap = () => face((g, px) => {
  g.fillStyle = '#c1272d';
  g.beginPath();
  const r = px * 0.46, cx = px / 2, cy = px / 2;
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) * Math.PI / 4;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = '#f4f4f4';
  g.stroke();
  g.fillStyle = '#f4f4f4';
  g.font = 'bold 28px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('STOP', cx, cy);
});

const speedMap = (limit: number) => face((g, px) => {
  g.fillStyle = '#f4f4f4';
  g.beginPath();
  g.arc(px / 2, px / 2, px * 0.46, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 10;
  g.strokeStyle = '#c1272d';
  g.stroke();
  g.fillStyle = '#1a1a1a';
  g.font = `bold ${limit > 99 ? 36 : 44}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(limit), px / 2, px / 2 + 2);
});

const yieldMap = () => face((g, px) => {
  g.fillStyle = '#c1272d';
  g.beginPath();
  g.moveTo(px / 2, px * 0.08);
  g.lineTo(px * 0.92, px * 0.9);
  g.lineTo(px * 0.08, px * 0.9);
  g.closePath();
  g.fill();
  g.fillStyle = '#f4f4f4';
  g.beginPath();
  g.moveTo(px / 2, px * 0.28);
  g.lineTo(px * 0.78, px * 0.82);
  g.lineTo(px * 0.22, px * 0.82);
  g.closePath();
  g.fill();
  g.fillStyle = '#1a1a1a';
  g.font = 'bold 18px sans-serif';
  g.textAlign = 'center';
  g.fillText('CEDA', px / 2, px * 0.68);
});

export type SignKind = 'stop' | 'yield' | 'speed30' | 'speed50' | 'speed80';

type SignKit = Record<SignKind, { board: THREE.MeshLambertMaterial; geo: THREE.BufferGeometry }>;

let kit: SignKit | null = null;

function octagon() {
  const s = new THREE.Shape();
  const r = 0.42;
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) * Math.PI / 4;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (k === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.translate(0, 0, 0);
  return g;
}

function triangle() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.46);
  s.lineTo(0.42, -0.4);
  s.lineTo(-0.42, -0.4);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

export function signKit(): SignKit {
  if (kit) return kit;
  const pole = new THREE.CylinderGeometry(0.04, 0.05, 2.55, 6);
  void pole;
  kit = {
    stop: { board: new THREE.MeshLambertMaterial({ map: stopMap() }), geo: octagon() },
    yield: { board: new THREE.MeshLambertMaterial({ map: yieldMap() }), geo: triangle() },
    speed30: { board: new THREE.MeshLambertMaterial({ map: speedMap(30) }), geo: new THREE.CircleGeometry(0.38, 22) },
    speed50: { board: new THREE.MeshLambertMaterial({ map: speedMap(50) }), geo: new THREE.CircleGeometry(0.38, 22) },
    speed80: { board: new THREE.MeshLambertMaterial({ map: speedMap(80) }), geo: new THREE.CircleGeometry(0.38, 22) }
  };
  return kit;
}

const poleGeo = new THREE.CylinderGeometry(0.045, 0.055, 2.6, 6);
const poleMat = new THREE.MeshLambertMaterial({ color: 0x6c737e });
const backMat = new THREE.MeshLambertMaterial({ color: 0xc9ccd2 });

export function makeSign(kind: SignKind): THREE.Group {
  const { board, geo } = signKit()[kind];
  const g = new THREE.Group();
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = 1.3;
  pole.castShadow = true;
  g.add(pole);
  const face = new THREE.Mesh(geo, board);
  face.position.set(0, 2.35, 0.05);
  g.add(face);
  const back = new THREE.Mesh(geo, backMat);
  back.position.set(0, 2.35, -0.02);
  back.rotation.y = Math.PI;
  g.add(back);
  return g;
}
