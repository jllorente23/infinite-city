import { CELL, STREET } from './config';

export function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash3(a: number, b: number, c: number) {
  let h = a | 0;
  h = Math.imul(h ^ (b * 374761393), 668265263);
  h = Math.imul(h ^ (c * 1274126177), 2246822519);
  h ^= h >>> 13; h = Math.imul(h, 3266489917); h ^= h >>> 16;
  return h;
}

/** Terrain is a sum of sines whose phases come from the seed. Cheap, continuous, deterministic. */
let phase = [0, 0, 0, 0];
export function setTerrainSeed(seed: number) {
  const r = mulberry32(seed * 31 + 7);
  phase = [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28];
}
export function heightAt(x: number, z: number) {
  return (
    3.2 * Math.sin(x * 0.011 + phase[0]) * Math.cos(z * 0.009 + phase[1]) +
    2.4 * Math.sin((x + z) * 0.016 + phase[2]) +
    1.1 * Math.sin(x * 0.027 + z * 0.021 + phase[3])
  );
}

/** Blocks sit on a raised platform. Kept out of the physics height, colliders handle it. */
export function isInsideBlock(x: number, z: number) {
  const lx = x - Math.floor(x / CELL) * CELL;
  const lz = z - Math.floor(z / CELL) * CELL;
  const m = STREET / 2;
  return lx > m && lx < CELL - m && lz > m && lz < CELL - m;
}

export function slopeNormal(x: number, z: number, out: { x: number; y: number; z: number }) {
  const e = 1.5;
  const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
  const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  const len = Math.hypot(-dx, 1, -dz);
  out.x = -dx / len; out.y = 1 / len; out.z = -dz / len;
  return out;
}
