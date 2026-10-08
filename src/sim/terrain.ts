// Tile classes for movement (screen.cpp query_grid_passable) and terrain genres
// (smooth.cpp query_genre_x_y). Numbers are the tile ids from pixdefs.h / TILE_FILES.

import { Genre } from './constants.ts';

export const TileClass = {
  /** Grass, floors, carpet, dirt, paths: anyone may walk here. */
  OPEN: 0,
  /** Tree canopy: forest walkers and flyers only. */
  TREE_TOP: 1,
  /** Tree trunk: as canopy, plus all weapons. */
  TREE_BOTTOM: 2,
  /** Solid walls: nobody (except ethereal). */
  WALL: 3,
  /** Arrow slits: blocks livings; weapons get a range-based chance through. */
  ARROW_SLIT: 4,
  /** Water, wall faces, torches, columns, boulders: weapons and flyers only. */
  LOW: 5,
  /** Anything else blocks. */
  BLOCKED: 6,
} as const;

// prettier-ignore
const OPEN = [
  1, 16, 17, 18, 82, 86, 87, 88, 83, 84, 92, 93, 94, 95, 96, 85, 79, 104, 105, 106, 107, 108, 109, 110, 111,
  112, 47, 48, 49, 50, 21, 51, 52, 72, 73, 75, 76, 43, 44, 45, 46, 27, 35, 36, 37, 6, 9, 11, 12, 13, 14, 15,
  10, 33, 34, 42, 127, 128, 129, 130, 131, 132, 133, 59, 60, 61, 62, 63, 103, 98, 99, 100, 101, 64, 65, 66, 74,
];
const TREE_TOP = [56, 58, 80, 81, 57];
const TREE_BOTTOM = [55];
const WALL = [0, 4, 5, 26, 38];
const ARROW_SLIT = [7, 8, 77, 78, 97];
// prettier-ignore
const LOW = [2, 19, 20, 29, 30, 31, 32, 68, 69, 70, 71, 23, 22, 24, 25, 102, 39, 40, 41, 28, 53, 54, 67, 89, 90, 91];

const GENRES: [number, number[]][] = [
  [Genre.GRASS, [1, 16, 17, 18, 47, 48, 49, 50]],
  [Genre.GRASS_DARK, [82, 83, 84, 85, 86, 87, 88, 92, 93, 94, 95, 96]],
  [Genre.GRASS_LIGHT, [104, 105, 106, 107, 108, 109, 110, 111, 112]],
  [Genre.CARPET, [9, 10, 11, 12, 13, 14, 15, 33, 34, 42, 127, 128, 129, 130, 131, 132, 133]],
  [Genre.WALL, [0, 4, 5, 7, 8, 22, 23, 24, 25, 26, 77, 78, 97, 102]],
  [Genre.WATER, [2, 19, 20, 29, 30, 31, 32]],
  [Genre.TREES, [55, 56, 57, 58, 80, 81]],
  [Genre.DIRT, [59, 60, 61, 62, 63]],
  [Genre.DIRT_DARK, [98, 99, 100, 101, 103]],
  [Genre.COBBLE, [72, 73, 75, 76]],
];

const TILE_CLASS = new Uint8Array(256).fill(TileClass.BLOCKED);
const TILE_GENRE = new Uint8Array(256).fill(Genre.UNKNOWN);

for (const [cls, ids] of [
  [TileClass.OPEN, OPEN],
  [TileClass.TREE_TOP, TREE_TOP],
  [TileClass.TREE_BOTTOM, TREE_BOTTOM],
  [TileClass.WALL, WALL],
  [TileClass.ARROW_SLIT, ARROW_SLIT],
  [TileClass.LOW, LOW],
] as const) {
  for (const id of ids) TILE_CLASS[id] = cls;
}
for (const [genre, ids] of GENRES) for (const id of ids) TILE_GENRE[id] = genre;

export function tileClass(tile: number): number {
  return TILE_CLASS[tile & 0xff];
}

export function tileGenre(tile: number): number {
  return TILE_GENRE[tile & 0xff];
}

/** Grass tiles that explosions scorch into PIX_GRASS1_DAMAGED (screen::damage_tile). */
export const SCORCHABLE = new Set([1, 16, 17, 18]);
export const GRASS_DAMAGED = 79;
/** smoother::query_x_y treats out-of-map cells as plain grass. */
export const OUTSIDE_TILE = 1;
