// Reads a .glb straight out of the container and reports, for every flat level
// in the model, how wide it is. Used to find where a road tile's driving
// surface actually sits: aligning tiles by their bounding box top put the
// verges on the street and buried the asphalt.
import { readFileSync } from 'node:fs';

type Accessor = { bufferView: number; componentType: number; count: number; type: string; byteOffset?: number };

function parseGlb(path: string) {
  const buf = readFileSync(path);
  let off = 12;
  let json: Record<string, never[]> | null = null;
  let bin: Buffer | null = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const kind = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (kind === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));
    else bin = body;
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json || !bin) throw new Error(`${path} is not a glb`);
  return { json: json as never as Gltf, bin };
}

type Gltf = {
  accessors: Accessor[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  meshes: { name?: string; primitives: { attributes: { POSITION: number } }[] }[];
  nodes: { name?: string; mesh?: number; scale?: number[]; translation?: number[] }[];
};

function positions(g: Gltf, bin: Buffer, index: number) {
  const acc = g.accessors[index];
  const view = g.bufferViews[acc.bufferView];
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = view.byteStride ?? 12;
  const out: [number, number, number][] = [];
  for (let k = 0; k < acc.count; k++) {
    const at = base + k * stride;
    out.push([bin.readFloatLE(at), bin.readFloatLE(at + 4), bin.readFloatLE(at + 8)]);
  }
  return out;
}

for (const name of process.argv.slice(2)) {
  const path = `public/models/props/${name}.glb`;
  const { json, bin } = parseGlb(path);
  const pts: [number, number, number][] = [];
  for (const mesh of json.meshes) for (const prim of mesh.primitives) pts.push(...positions(json, bin, prim.attributes.POSITION));

  const ys = pts.map((p) => p[1]);
  console.log(`\n${name}: ${pts.length} verts, y ${Math.min(...ys).toFixed(3)} .. ${Math.max(...ys).toFixed(3)}`);

  // Group vertices into flat levels and report the footprint of each.
  const levels = new Map<string, [number, number, number][]>();
  for (const p of pts) {
    const key = p[1].toFixed(3);
    if (!levels.has(key)) levels.set(key, []);
    levels.get(key)!.push(p);
  }
  const rows = [...levels.entries()]
    .map(([y, v]) => ({
      y: Number(y),
      n: v.length,
      x: [Math.min(...v.map((p) => p[0])), Math.max(...v.map((p) => p[0]))],
      z: [Math.min(...v.map((p) => p[2])), Math.max(...v.map((p) => p[2]))]
    }))
    .sort((a, b) => b.y - a.y);
  for (const r of rows.slice(0, 8)) {
    console.log(`  y=${r.y.toFixed(3)}  ${String(r.n).padStart(5)} verts  x ${r.x[0].toFixed(2)}..${r.x[1].toFixed(2)}  z ${r.z[0].toFixed(2)}..${r.z[1].toFixed(2)}`);
  }
}
