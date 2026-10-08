// Simulation constants from base.h, stats.h and smooth.h.

export const GRID_SIZE = 16;
export const NUM_FACINGS = 8;
export const NUM_SPECIALS = 6;
/** Cap on living objects; note the original only ever counts up (see World.numobs). */
export const MAXOBS = 150;
/** Used to compute fractional regeneration rates. */
export const REGEN = 4000;
export const FAERIE_FREEZE_TIME = 40;
export const STANDARD_TEXT_TIME = 75;
/** screen.cpp: how far find_near_foe spirals before giving up. */
export const MAX_SPREAD = 10;
/** stats.cpp: probe distance for right-hand-rule wall following. */
export const CHECK_STEP_SIZE = 1;

/** Difficulty multipliers in percent (picker.cpp difficulty_level). */
export const DIFFICULTY_LEVELS = [50, 100, 200] as const;
export const DEFAULT_DIFFICULTY = 1;

export const Act = {
  RANDOM: 0,
  FIRE: 1,
  CONTROL: 2,
  GUARD: 3,
  GENERATE: 4,
  DIE: 5,
  SIT: 6,
} as const;

export const Ani = {
  WALK: 0,
  ATTACK: 1,
  TELE_OUT: 2,
  SKEL_GROW: 3,
  TELE_IN: 3,
  SLIME_SPLIT: 4,
  // Weapons and effects reuse slot 1/2 for their own sequences.
  GROW: 1,
  GLOWGROW: 1,
  GLOWPULSE: 2,
  EXPAND_8: 1,
  DOOR_OPEN: 1,
  SCARE: 1,
  BOMB: 1,
  EXPLODE: 1,
  SPIN: 1,
} as const;

export const Face = {
  UP: 0,
  UP_RIGHT: 1,
  RIGHT: 2,
  DOWN_RIGHT: 3,
  DOWN: 4,
  DOWN_LEFT: 5,
  LEFT: 6,
  UP_LEFT: 7,
} as const;

export const Bit = {
  FLYING: 1,
  SWIMMING: 2,
  ANIMATE: 4,
  INVINCIBLE: 8,
  NO_RANGED: 16,
  IMMORTAL: 32,
  NO_COLLIDE: 64,
  PHANTOM: 128,
  NAMED: 256,
  FORESTWALK: 512,
  MAGICAL: 1024,
  FIRE: 2048,
  ETHEREAL: 4096,
} as const;

export const Command = {
  WALK: 1,
  FIRE: 2,
  RANDOM_WALK: 3,
  DIE: 4,
  FOLLOW: 5,
  RUSH: 6,
  MULTIDO: 7,
  QUICK_FIRE: 8,
  SET_WEAPON: 9,
  RESET_WEAPON: 10,
  SEARCH: 11,
  ATTACK: 12,
  RIGHT_WALK: 13,
  UNCHARM: 14,
} as const;

export const Action = {
  NONE: 0,
  FOLLOW: 1,
} as const;

export const ScenType = {
  CAN_EXIT: 1,
  GEN_EXIT: 2,
  SAVE_ALL: 4,
} as const;

/** Terrain "genres" used by forest walking, doors and tile damage (smooth.h). */
export const Genre = {
  GRASS: 1,
  WATER: 2,
  TREES: 3,
  DIRT: 4,
  COBBLE: 5,
  GRASS_DARK: 6,
  DIRT_DARK: 7,
  WALL: 8,
  CARPET: 9,
  GRASS_LIGHT: 10,
  UNKNOWN: 50,
} as const;
