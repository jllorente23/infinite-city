import { CELL, DAY_SECONDS } from './config';
import { hash3 } from './rng';

export const CYCLE = 38;

/**
 * 2 green, 1 amber, 0 red. Each axis gets 14 s green, 3 s amber and a
 * 2 s all-red clearance before cross traffic moves.
 */
export function signalState(seed: number, nx: number, nz: number, axisX: boolean, clockHours: number) {
  const ph = ((hash3(seed, Math.round(nx / CELL), Math.round(nz / CELL)) >>> 0) % 1000) / 1000;
  const elapsedSeconds = clockHours * (DAY_SECONDS / 24);
  const t = (elapsedSeconds + ph * CYCLE) % CYCLE;
  if (axisX) return t < 14 ? 2 : t < 17 ? 1 : 0;
  return t >= 19 && t < 33 ? 2 : t >= 33 && t < 36 ? 1 : 0;
}
