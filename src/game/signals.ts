import { CELL } from './config';
import { hash3 } from './rng';

export const CYCLE = 12;

/** 2 green, 1 amber, 0 red. Phase comes from the intersection, so they never sync up. */
export function signalState(seed: number, nx: number, nz: number, axisX: boolean, clock: number) {
  const ph = ((hash3(seed, Math.round(nx / CELL), Math.round(nz / CELL)) >>> 0) % 1000) / 1000;
  const t = (clock + ph * CYCLE) % CYCLE;
  if (axisX) return t < 5 ? 2 : t < 6 ? 1 : 0;
  return t >= 6 && t < 11 ? 2 : t >= 11 ? 1 : 0;
}
