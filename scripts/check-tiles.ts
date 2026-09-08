// How far the rendered ground mesh rises above the plane a road tile is laid
// on. The mesh only samples `heightAt` at its grid corners, so between them it
// can sit higher than the tile and hide it.
import { CELL, ROAD_TILE, ROAD_TILE_LIFT, STREET } from '../src/game/config';
import { heightAt, setTerrainSeed } from '../src/game/rng';

setTerrainSeed(1337);

/** Height of the ground mesh, which is a `segs x segs` grid over one cell. */
function meshHeight(cx: number, cz: number, segs: number, x: number, z: number) {
  const step = CELL / segs;
  const x0 = cx - CELL / 2, z0 = cz - CELL / 2;
  const gi = Math.min(segs - 1, Math.floor((x - x0) / step));
  const gj = Math.min(segs - 1, Math.floor((z - z0) / step));
  const fx = (x - x0 - gi * step) / step;
  const fz = (z - z0 - gj * step) / step;
  const h = (a: number, b: number) => heightAt(x0 + (gi + a) * step, z0 + (gj + b) * step);
  // PlaneGeometry splits each quad along the a=b diagonal.
  const [p, q, r, wu, wv] = fx + fz <= 1
    ? [h(0, 0), h(1, 0), h(0, 1), fx, fz]
    : [h(1, 1), h(0, 1), h(1, 0), 1 - fx, 1 - fz];
  return p + (q - p) * wu + (r - p) * wv;
}

/** Top face of the tile centred on (tx,tz), tilted to the local gradient. */
function tileHeight(tx: number, tz: number, x: number, z: number) {
  const H = ROAD_TILE / 2;
  const gx = (heightAt(tx + H, tz) - heightAt(tx - H, tz)) / ROAD_TILE;
  const gz = (heightAt(tx, tz + H) - heightAt(tx, tz - H)) / ROAD_TILE;
  return heightAt(tx, tz) + ROAD_TILE_LIFT + gx * (x - tx) + gz * (z - tz);
}

let worst = -Infinity, worstAt = '';
let buried = 0, total = 0;
for (const segs of [Number(process.argv[2] ?? 10)]) {
  for (let ci = -3; ci <= 3; ci++) {
    for (let cj = -3; cj <= 3; cj++) {
      const ox = ci * CELL, oz = cj * CELL;
      const cx = ox + CELL / 2, cz = oz + CELL / 2;
      // Walk the street that runs along this cell's low z edge.
      for (let k = 0; k < 7; k++) {
        const tx = ox + (k + 0.5) * ROAD_TILE, tz = oz;
        for (let a = -6.5; a <= 6.5; a += 0.5) {
          for (let b = -6.5; b <= 6.5; b += 0.5) {
            const x = tx + a, z = tz + b;
            if (Math.abs(b) > STREET / 2) continue;
            // The strip below the edge belongs to the neighbouring cell's mesh.
            const mz = b < 0 ? cz - CELL : cz;
            const gap = tileHeight(tx, tz, x, z) - meshHeight(cx, mz, segs, x, z);
            total++;
            if (gap < 0) buried++;
            if (-gap > worst) { worst = -gap; worstAt = `segs=${segs} cell(${ci},${cj}) tile ${k}`; }
          }
        }
      }
    }
  }
}

console.log(`lift ${ROAD_TILE_LIFT} m`);
console.log(`${buried} of ${total} sampled points are under the ground mesh`);
console.log(`ground rises up to ${worst.toFixed(3)} m above the tile (${worstAt})`);
console.log(worst < 0 ? 'tiles clear the ground everywhere' : 'TILES ARE BURIED');
