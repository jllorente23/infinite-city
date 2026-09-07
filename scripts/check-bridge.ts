/* Sanity pass over a canal crossing: the driving surface must be continuous,
 * the deck must sit where the model puts its roadway, and open water must stay
 * blocked. Run with `npx tsx scripts/check-bridge.ts`. */
import { blockTypeAt, canalAxis, canalBlocks, canalCrossing, hasSignals, isDriveable, roadHeightAt, signalPosts } from '../src/game/city';
import { BLOCK, BRIDGE_DECK_W, BRIDGE_EVERY, BRIDGE_RAMP, BRIDGE_RISE, BRIDGE_SPAN, CANAL_W, CELL, LOT_GRID, SIDEWALK, STREET } from '../src/game/config';
import { BRIDGE_TOP } from '../src/game/props';
import { heightAt } from '../src/game/rng';

const SEED = 1337;
let bad = 0;
const fail = (m: string) => { console.log('  FAIL ' + m); bad++; };

// How often a canal is actually crossed.
let cross = 0;
for (let n = -300; n < 300; n++) if (canalCrossing(SEED, n, 9311)) cross++;
console.log(`crossings: ${cross}/600 boundaries (expected ~${600 / BRIDGE_EVERY})`);
if (Math.abs(cross - 600 / BRIDGE_EVERY) > 2) fail('crossing density is off');

// Find a real canal cell that owns a crossing.
let found: { i: number; j: number; alongX: boolean } | null = null;
outer: for (let i = -40; i <= 40 && !found; i++) {
  for (let j = -40; j <= 40; j++) {
    if (blockTypeAt(SEED, i, j) !== 'canal') continue;
    const ax = canalAxis(SEED, i, j);
    if ((ax === 'z' || ax === 'both') && canalCrossing(SEED, j, 9311)) { found = { i, j, alongX: true }; break outer; }
    if ((ax === 'x' || ax === 'both') && canalCrossing(SEED, i, 9312)) { found = { i, j, alongX: false }; break outer; }
  }
}
if (!found) { console.log('FAIL no canal crossing found'); process.exit(1); }
const { i, j, alongX } = found;
console.log(`crossing at cell (${i},${j}), roadway along ${alongX ? 'X' : 'Z'}`);

const mid = (alongX ? i : j) * CELL + CELL / 2;
const lat = (alongX ? j : i) * CELL;
const at = (a: number) => (alongX ? roadHeightAt(SEED, mid + a, lat) : roadHeightAt(SEED, lat, mid + a));
const deckY = heightAt(alongX ? mid : lat, alongX ? lat : mid) + BRIDGE_RISE;

// 1. The surface must never step. A jump is what throws the car.
let worst = 0, worstAt = 0;
for (let a = -40; a <= 40; a += 0.1) {
  const d = Math.abs(at(a + 0.1) - at(a));
  if (d > worst) { worst = d; worstAt = a; }
}
console.log(`largest step over 10 cm of road: ${worst.toFixed(4)} m at a=${worstAt.toFixed(1)}`);
if (worst > 0.06) fail('the road surface has a lip');

// 2. Flat over the water, back on the ground past the ramp.
for (const a of [-BRIDGE_SPAN / 2, -4, 0, 4, BRIDGE_SPAN / 2]) {
  if (Math.abs(at(a) - deckY) > 1e-6) fail(`deck not level at a=${a}`);
}
const edge = BRIDGE_SPAN / 2 + BRIDGE_RAMP;
for (const a of [-edge, edge]) {
  const ground = alongX ? heightAt(mid + a, lat) : heightAt(lat, mid + a);
  if (Math.abs(at(a) - ground) > 1e-6) fail(`ramp does not land on the ground at a=${a}`);
}
console.log(`deck ${(deckY - heightAt(alongX ? mid : lat, alongX ? lat : mid)).toFixed(2)} m up, ramp ${BRIDGE_RAMP} m long -> ${((BRIDGE_RISE / BRIDGE_RAMP) * 100).toFixed(1)}% grade`);
if (edge > CELL / 2) fail('the crossing spills into the neighbouring block');

// 3. The model's roadway has to land exactly on that deck.
const originY = deckY - BRIDGE_TOP * BRIDGE_DECK_W;
const roadway = originY + BRIDGE_TOP * BRIDGE_DECK_W;
console.log(`model roadway at ${roadway.toFixed(3)}, deck at ${deckY.toFixed(3)}`);
if (Math.abs(roadway - deckY) > 1e-9) fail('the model floats or sinks');
if (Math.abs(BRIDGE_DECK_W * 0.8 - STREET) > 1e-9) fail('lanes are not STREET wide');

// 4. Water is only passable on the deck.
for (const a of [-6, 0, 6]) {
  const [x, z] = alongX ? [mid + a, lat] : [lat, mid + a];
  if (canalBlocks(SEED, x, z)) fail(`the deck reads as water at a=${a}`);
}
for (const off of [STREET / 2 + 6, STREET / 2 + 18]) {
  const [x, z] = alongX ? [mid, lat + off] : [lat + off, mid];
  if (!canalBlocks(SEED, x, z)) fail(`open water ${off} m off the deck is not blocked`);
}
// Every street along this canal that has no bridge must be closed, and every
// one that does must be open. Cells the highway took over are not canal at all.
const salt = alongX ? 9311 : 9312;
let open = 0, shut = 0;
for (let n = (alongX ? j : i) - 6; n <= (alongX ? j : i) + 6; n++) {
  const cell = alongX ? [i, n] : [n, j];
  if (blockTypeAt(SEED, cell[0], cell[1]) !== 'canal') continue;
  const [x, z] = alongX ? [mid, n * CELL] : [n * CELL, mid];
  const blocked = canalBlocks(SEED, x, z);
  if (canalCrossing(SEED, n, salt)) {
    open++;
    if (blocked) fail(`boundary ${n} has a bridge but reads as water`);
  } else {
    shut++;
    if (!blocked) fail(`boundary ${n} has no bridge but is not closed`);
  }
}
console.log(`neighbouring streets on this canal: ${open} bridged, ${shut} closed at the quay`);

// 5. Where the piers stand, relative to the channel.
console.log(`deck spans ${BRIDGE_SPAN} m over ${CANAL_W} m of water; legs land ${((0.4 * BRIDGE_SPAN) - CANAL_W / 2).toFixed(1)} m onto each bank`);
if (0.4 * BRIDGE_SPAN <= CANAL_W / 2) fail('the deck legs stand in the water');

// 6. No signal post may stand on asphalt.
let posts = 0, worstClear = Infinity;
for (let n = -30; n <= 30; n++) {
  for (let m = -30; m <= 30; m++) {
    const jx = n * CELL, jz = m * CELL;
    if (!hasSignals(SEED, jx, jz)) continue;
    for (const p of signalPosts(jx, jz)) {
      posts++;
      if (isDriveable(SEED, p.x, p.z)) fail(`signal post at ${p.x},${p.z} stands on the roadway`);
      // Distance from the post to the nearest kerb.
      const lx = ((p.x % CELL) + CELL) % CELL;
      const lz = ((p.z % CELL) + CELL) % CELL;
      const clear = Math.min(
        Math.min(lx, CELL - lx) - STREET / 2,
        Math.min(lz, CELL - lz) - STREET / 2
      );
      worstClear = Math.min(worstClear, clear);
    }
  }
}
console.log(`\n${posts} signal posts checked, closest one ${worstClear.toFixed(2)} m behind the kerb`);
if (worstClear < 1.5) fail('signal posts hug the kerb');

// 7. Every block has to hold room for a grid of lots.
const inner = BLOCK - 2 * SIDEWALK;
console.log(`block ${BLOCK} m, buildable ${inner} m -> lots of ${LOT_GRID.map((g) => (inner / g).toFixed(0) + 'm x' + g * g).join(', ')}`);
if (inner / Math.max(...LOT_GRID) < 14) fail('the tightest lot grid leaves shoebox buildings');
if (Math.min(...LOT_GRID) < 2) fail('a block must hold more than one building');

// 8. Falling in the canal must always have somewhere dry to land.
let rescued = 0;
const wet: [number, number][] = [];
let canalCells = 0;
for (let ci = -90; ci <= 90; ci++) {
  for (let cj = -90; cj <= 90; cj++) {
    if (blockTypeAt(SEED, ci, cj) !== 'canal') continue;
    canalCells++;
    for (let a = 0.1; a < 1; a += 0.1) {
      for (let b = 0.1; b < 1; b += 0.1) wet.push([(ci + a) * CELL, (cj + b) * CELL]);
    }
  }
}
for (const [x, z] of wet) {
  if (!canalBlocks(SEED, x, z)) continue;
  rescued++;
  const ox = x - (((x % CELL) + CELL) % CELL);
  const oz = z - (((z % CELL) + CELL) % CELL);
  const dry = [
    { x: ox, z }, { x: ox + CELL, z }, { x, z: oz }, { x, z: oz + CELL },
    { x: ox, z: oz }, { x: ox + CELL, z: oz }, { x: ox, z: oz + CELL }, { x: ox + CELL, z: oz + CELL }
  ].filter((c) => !canalBlocks(SEED, c.x, c.z));
  if (!dry.length) fail(`no dry landing for a jeep in the water at ${x.toFixed(0)},${z.toFixed(0)}`);
}
console.log(`${canalCells} canal cells in a 181x181 sweep; ${rescued} of ${wet.length} sampled points are open water, all with a dry landing`);
if (!rescued) fail('the water sampling never found a canal, so this proves nothing');

console.log(bad ? `\n${bad} PROBLEM(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);
