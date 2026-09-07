export const BLOCK = 36;
export const STREET = 14;
export const CELL = BLOCK + STREET;
export const SIDEWALK = 4;
export const DAY_SECONDS = 240;

export const QUALITY = {
  high: { loadRadius: 8, detailRadius: 2, midRadius: 5, shadows: true, dpr: 2, traffic: 24, post: true, clouds: true },
  low: { loadRadius: 6, detailRadius: 1, midRadius: 4, shadows: false, dpr: 1.3, traffic: 14, post: false, clouds: false }
};

/** Radius of the sky dome. The camera's far plane has to sit beyond this or the
 *  whole sky gets clipped away. */
export const SKY_RADIUS = 900;
export type QualityName = keyof typeof QUALITY;

export const PALETTE = [0x9aa3b5, 0xcbbca6, 0x8f9aa1, 0xb5aebd, 0xa9b3a3, 0xd6c8b6, 0x7e8ea3, 0xb99a86];
