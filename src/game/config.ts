/** A block is big enough to hold a grid of lots, so a city block reads as a
 *  row of buildings rather than one object dropped in the middle. */
export const BLOCK = 84;
export const STREET = 14;
export const CELL = BLOCK + STREET;
/** Kenney's road tiles are square and as wide as the roadway, so a cell edge
 *  has to be a whole number of them: 98 / 14 = 7. */
export const ROAD_TILE = STREET;
export const ROAD_TILES_PER_EDGE = CELL / ROAD_TILE;
export const SIDEWALK = 4;
/** Lots per side of a block. The interior lot of an odd grid becomes a yard. */
export const LOT_GRID = [2, 3, 3, 4];
export const DAY_SECONDS = 240;

/** Dual-carriageway that occasionally replaces a whole corridor of blocks. */
export const HW_LANE = 3.6;
export const HW_MEDIAN = 2.8;
export const HW_SHOULDER = 2.4;
export const HW_WIDTH = HW_LANE * 4 + HW_MEDIAN + HW_SHOULDER * 2;
export const HW_INNER = HW_MEDIAN / 2 + HW_LANE / 2;
export const HW_OUTER = HW_MEDIAN / 2 + HW_LANE * 1.5;
export const CANAL_W = 26;
/** Kenney's `road-bridge` tile carries its roadway between two kerbs that take
 *  up a fifth of the tile, so this is the scale that makes the lanes `STREET`
 *  wide. */
export const BRIDGE_DECK_W = STREET / 0.8;
/** Deck plus ramps must stay inside one cell so a crossing never reaches past
 *  the neighbouring block. Keep the ramp short enough that the climb is felt. */
export const BRIDGE_SPAN = 38;
export const BRIDGE_RAMP = 15;
export const BRIDGE_RISE = 1.5;
/** One crossing every this many blocks along a canal. */
export const BRIDGE_EVERY = 2;
export const CORNER_R = 3.4;
export const LOT_COLS = 8;
export const LOT_ROWS = 2;
export const LOT_SLOT_W = 2.55;
export const LOT_SLOT_D = 5.1;
export const LOT_AISLE = 5.8;

/** Radii are in cells, so they shrink as `CELL` grows: what matters is how many
 *  square metres are alive, not how many chunks. */
export const QUALITY = {
  high: { loadRadius: 4, detailRadius: 1, midRadius: 2, shadows: true, dpr: 2, traffic: 24, clouds: true },
  low: { loadRadius: 3, detailRadius: 1, midRadius: 2, shadows: false, dpr: 1.3, traffic: 14, clouds: false }
};

/** Radius of the sky dome. The camera's far plane has to sit beyond this or the
 *  whole sky gets clipped away. */
export const SKY_RADIUS = 900;
export type QualityName = keyof typeof QUALITY;

export const PALETTE = [0x9aa3b5, 0xcbbca6, 0x8f9aa1, 0xb5aebd, 0xa9b3a3, 0xd6c8b6, 0x7e8ea3, 0xb99a86];
