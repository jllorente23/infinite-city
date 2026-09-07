export const BLOCK = 36;
export const STREET = 14;
export const CELL = BLOCK + STREET;
export const SIDEWALK = 4;
export const DAY_SECONDS = 240;

/** Dual-carriageway that occasionally replaces a whole corridor of blocks. */
export const HW_LANE = 3.6;
export const HW_MEDIAN = 2.8;
export const HW_SHOULDER = 2.4;
export const HW_WIDTH = HW_LANE * 4 + HW_MEDIAN + HW_SHOULDER * 2;
export const HW_INNER = HW_MEDIAN / 2 + HW_LANE / 2;
export const HW_OUTER = HW_MEDIAN / 2 + HW_LANE * 1.5;
export const CANAL_W = 16;
/** Kenney's `road-bridge` tile carries its roadway between two kerbs that take
 *  up a fifth of the tile, so this is the scale that makes the lanes `STREET`
 *  wide. */
export const BRIDGE_DECK_W = STREET / 0.8;
/** Deck plus ramps add up to exactly one cell, so a crossing never reaches past
 *  the neighbouring block. */
export const BRIDGE_SPAN = 26;
export const BRIDGE_RAMP = CELL / 2 - BRIDGE_SPAN / 2;
export const BRIDGE_RISE = 1.25;
/** One crossing every this many blocks along a canal. */
export const BRIDGE_EVERY = 3;
export const CORNER_R = 3.4;
export const LOT_COLS = 8;
export const LOT_ROWS = 2;
export const LOT_SLOT_W = 2.55;
export const LOT_SLOT_D = 5.1;
export const LOT_AISLE = 5.8;

export const QUALITY = {
  high: { loadRadius: 8, detailRadius: 2, midRadius: 5, shadows: true, dpr: 2, traffic: 24, clouds: true },
  low: { loadRadius: 6, detailRadius: 1, midRadius: 4, shadows: false, dpr: 1.3, traffic: 14, clouds: false }
};

/** Radius of the sky dome. The camera's far plane has to sit beyond this or the
 *  whole sky gets clipped away. */
export const SKY_RADIUS = 900;
export type QualityName = keyof typeof QUALITY;

export const PALETTE = [0x9aa3b5, 0xcbbca6, 0x8f9aa1, 0xb5aebd, 0xa9b3a3, 0xd6c8b6, 0x7e8ea3, 0xb99a86];
