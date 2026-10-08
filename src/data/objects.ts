// Object orders/families (base.h) and their sprite files (loader.cpp).

export const Order = {
  LIVING: 0,
  WEAPON: 1,
  TREASURE: 2,
  GENERATOR: 3,
  FX: 4,
  SPECIAL: 5,
  BUTTON1: 6,
} as const;

export type OrderId = (typeof Order)[keyof typeof Order];

export const LivingFamily = {
  SOLDIER: 0,
  ELF: 1,
  ARCHER: 2,
  MAGE: 3,
  SKELETON: 4,
  CLERIC: 5,
  FIREELEMENTAL: 6,
  FAERIE: 7,
  SLIME: 8,
  SMALL_SLIME: 9,
  MEDIUM_SLIME: 10,
  THIEF: 11,
  GHOST: 12,
  DRUID: 13,
  ORC: 14,
  BIG_ORC: 15,
  BARBARIAN: 16,
  ARCHMAGE: 17,
  GOLEM: 18,
  GIANT_SKELETON: 19,
  TOWER1: 20,
} as const;

export const WeaponFamily = {
  KNIFE: 0,
  ROCK: 1,
  ARROW: 2,
  FIREBALL: 3,
  TREE: 4,
  METEOR: 5,
  SPRINKLE: 6,
  BONE: 7,
  BLOOD: 8,
  BLOB: 9,
  FIRE_ARROW: 10,
  LIGHTNING: 11,
  GLOW: 12,
  WAVE: 13,
  WAVE2: 14,
  WAVE3: 15,
  CIRCLE_PROTECTION: 16,
  HAMMER: 17,
  DOOR: 18,
  BOULDER: 19,
} as const;

export const TreasureFamily = {
  STAIN: 0,
  DRUMSTICK: 1,
  GOLD_BAR: 2,
  SILVER_BAR: 3,
  MAGIC_POTION: 4,
  INVIS_POTION: 5,
  INVULNERABLE_POTION: 6,
  FLIGHT_POTION: 7,
  EXIT: 8,
  TELEPORTER: 9,
  LIFE_GEM: 10,
  KEY: 11,
  SPEED_POTION: 12,
} as const;

export const GeneratorFamily = {
  TENT: 0,
  TOWER: 1,
  BONES: 2,
  TREEHOUSE: 3,
} as const;

export const FxFamily = {
  EXPAND: 0,
  GHOST_SCARE: 1,
  BOMB: 2,
  EXPLOSION: 3,
  FLASH: 4,
  MAGIC_SHIELD: 5,
  KNIFE_BACK: 6,
  BOOMERANG: 7,
  CLOUD: 8,
  MARKER: 9,
  CHAIN: 10,
  DOOR_OPEN: 11,
} as const;

export const SpecialFamily = {
  RESERVED_TEAM: 0,
} as const;

export const ButtonFamily = {
  NORMAL1: 0,
  PLUS: 1,
  MINUS: 2,
} as const;

/** Sprite file per [order][family]; families without graphics are absent. */
export const SPRITE_FILES: Readonly<Record<number, Readonly<Record<number, string>>>> = {
  [Order.LIVING]: {
    0: 'footman', // SOLDIER
    1: 'elf', // ELF
    2: 'archer', // ARCHER
    3: 'mage', // MAGE
    4: 'skeleton', // SKELETON
    5: 'cleric', // CLERIC
    6: 'firelem', // FIREELEMENTAL
    7: 'faerie', // FAERIE
    8: 'amoeba3', // SLIME
    9: 's_slime', // SMALL_SLIME
    10: 'm_slime', // MEDIUM_SLIME
    11: 'thief', // THIEF
    12: 'ghost', // GHOST
    13: 'druid', // DRUID
    14: 'orc', // ORC
    15: 'orc2', // BIG_ORC
    16: 'barby', // BARBARIAN
    17: 'archmage', // ARCHMAGE
    18: 'golem1', // GOLEM
    19: 'gs1', // GIANT_SKELETON
    20: 'towersm1', // TOWER1
  },
  [Order.WEAPON]: {
    0: 'knife', // KNIFE
    1: 'rock', // ROCK
    2: 'arrow', // ARROW
    3: 'fire', // FIREBALL
    4: 'tree', // TREE
    5: 'meteor', // METEOR
    6: 'sparkle', // SPRINKLE
    7: 'bone1', // BONE
    8: 'blood', // BLOOD
    9: 'sl_ball', // BLOB
    10: 'farrow', // FIRE_ARROW
    11: 'lightnin', // LIGHTNING
    12: 'clerglow', // GLOW
    13: 'wave', // WAVE
    14: 'wave2', // WAVE2
    15: 'wave3', // WAVE3
    16: 'wave2', // CIRCLE_PROTECTION
    17: 'hammer', // HAMMER
    18: 'door', // DOOR
    19: 'boulder1', // BOULDER
  },
  [Order.TREASURE]: {
    0: 'stain', // STAIN
    1: 'food1', // DRUMSTICK
    2: 'bar1', // GOLD_BAR
    3: 'bar1', // SILVER_BAR
    4: 'bottle', // MAGIC_POTION
    5: 'bottle', // INVIS_POTION
    6: 'bottle', // INVULNERABLE_POTION
    7: 'bottle', // FLIGHT_POTION
    8: '16exit1', // EXIT
    9: 'teleport', // TELEPORTER
    10: 'lifegem', // LIFE_GEM
    11: 'key', // KEY
    12: 'bottle', // SPEED_POTION
  },
  [Order.GENERATOR]: {
    0: 'tent', // TENT
    1: 'tower4', // TOWER
    2: 'bonepile', // BONES
    3: 'bigtree', // TREEHOUSE
  },
  [Order.FX]: {
    0: 'expand8', // EXPAND
    1: 'expand8', // GHOST_SCARE
    2: 'bomb1', // BOMB
    3: 'boom1', // EXPLOSION
    4: 'telflash', // FLASH
    5: 'mshield', // MAGIC_SHIELD
    6: 'knife', // KNIFE_BACK
    7: 'boomer', // BOOMERANG
    8: 'cloud', // CLOUD
    9: 'marker', // MARKER
    10: 'lightnin', // CHAIN
    11: 'door', // DOOR_OPEN
  },
  [Order.SPECIAL]: {
    0: 'team', // RESERVED_TEAM
  },
  [Order.BUTTON1]: {
    0: 'normal1', // NORMAL1
    1: 'butplus', // PLUS
    2: 'butminus', // MINUS
  },
};

/** Friendly-team variants of gore sprites. */
export const FRIENDLY_SPRITE_FILES: Readonly<Record<string, string>> = {
  blood: 'blood_friendly',
  stain: 'stain_friendly',
};
