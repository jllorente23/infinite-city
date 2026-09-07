import { create } from 'zustand';
import { QUALITY, QualityName } from './config';

export type Controls = { throttle: number; brake: number; steer: number };

/** Input lives outside React state: it changes every frame and must not re-render. */
export const controls: Controls = { throttle: 0, brake: 0, steer: 0 };
export const playerPos = { x: 0, y: 0, z: 0, heading: 0 };

type GameState = {
  seed: number;
  quality: QualityName;
  speed: number;
  score: number;
  distance: number;
  clock: number;
  night: number;
  setSeed: (s: number) => void;
  setQuality: (q: QualityName) => void;
  setHud: (v: Partial<Pick<GameState, 'speed' | 'score' | 'distance' | 'clock' | 'night'>>) => void;
};

export const useGame = create<GameState>((set) => ({
  seed: 7,
  quality: typeof window !== 'undefined' && 'ontouchstart' in window ? 'low' : 'high',
  speed: 0,
  score: 0,
  distance: 0,
  clock: 7.2,
  night: 0,
  setSeed: (seed) => set({ seed, score: 0 }),
  setQuality: (quality) => set({ quality }),
  setHud: (v) => set(v)
}));

export const qualityOf = (name: QualityName) => QUALITY[name];
