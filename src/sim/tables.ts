// Per order/family base values from loader.cpp's constructor. Entries the original never set
// default to zero (its tables were freshly allocated), and an unset act type is ACT_RANDOM.

import { FxFamily, GeneratorFamily, LivingFamily as L, Order, TreasureFamily as T, WeaponFamily as W } from '../data/objects.ts';
import { ANI, type AnimationSet } from './animations.ts';
import { Act } from './constants.ts';

export interface TypeInfo {
  hitpoints: number;
  act: number;
  ani: AnimationSet | null;
  stepsize: number;
  lineofsight: number;
  damage: number;
  fireFrequency: number;
}

type Row = Partial<TypeInfo>;

// prettier-ignore
const LIVING: Record<number, Row> = {
  //                         hp   ani            step sight dmg  freq
  [L.SOLDIER]:          { hitpoints: 90,  ani: ANI.man,        stepsize: 4, lineofsight: 7,  damage: 20, fireFrequency: 6 },
  [L.ELF]:              { hitpoints: 30,  ani: ANI.man,        stepsize: 2, lineofsight: 8,  damage: 12, fireFrequency: 7 },
  [L.ARCHER]:           { hitpoints: 60,  ani: ANI.man,        stepsize: 4, lineofsight: 12, damage: 8,  fireFrequency: 5 },
  [L.THIEF]:            { hitpoints: 45,  ani: ANI.man,        stepsize: 5, lineofsight: 10, damage: 12, fireFrequency: 5 },
  [L.MAGE]:             { hitpoints: 60,  ani: ANI.mage,       stepsize: 2, lineofsight: 7,  damage: 4,  fireFrequency: 4 },
  [L.SKELETON]:         { hitpoints: 30,  ani: ANI.skel,       stepsize: 6, lineofsight: 7,  damage: 4,  fireFrequency: 6 },
  [L.CLERIC]:           { hitpoints: 90,  ani: ANI.man,        stepsize: 2, lineofsight: 4,  damage: 12, fireFrequency: 9 },
  [L.FIREELEMENTAL]:    { hitpoints: 150, ani: ANI.man,        stepsize: 4, lineofsight: 10, damage: 12, fireFrequency: 5 },
  [L.FAERIE]:           { hitpoints: 45,  ani: ANI.man,        stepsize: 4, lineofsight: 8,  damage: 3,  fireFrequency: 9 },
  [L.SLIME]:            { hitpoints: 120, ani: ANI.slime,      stepsize: 3, lineofsight: 4,  damage: 28, fireFrequency: 11 },
  [L.SMALL_SLIME]:      { hitpoints: 30,  ani: ANI.smallSlime, stepsize: 2, lineofsight: 2,  damage: 12, fireFrequency: 12 },
  [L.MEDIUM_SLIME]:     { hitpoints: 30,  ani: ANI.smallSlime, stepsize: 2, lineofsight: 3,  damage: 20, fireFrequency: 10 },
  [L.GHOST]:            { hitpoints: 40,  ani: ANI.man,        stepsize: 4, lineofsight: 12, damage: 6,  fireFrequency: 5 },
  [L.DRUID]:            { hitpoints: 80,  ani: ANI.man,        stepsize: 3, lineofsight: 10, damage: 10, fireFrequency: 9 },
  [L.ORC]:              { hitpoints: 110, ani: ANI.man,        stepsize: 3, lineofsight: 20, damage: 25, fireFrequency: 7 },
  [L.BIG_ORC]:          { hitpoints: 150, ani: ANI.man,        stepsize: 3, lineofsight: 25, damage: 30, fireFrequency: 6 },
  [L.BARBARIAN]:        { hitpoints: 120, ani: ANI.man,        stepsize: 4, lineofsight: 12, damage: 25, fireFrequency: 5 },
  [L.ARCHMAGE]:         { hitpoints: 120, ani: ANI.mage,       stepsize: 3, lineofsight: 10, damage: 8,  fireFrequency: 1 },
  [L.GOLEM]:            { hitpoints: 270, ani: ANI.man,        stepsize: 8, lineofsight: 20, damage: 60, fireFrequency: 9 },
  [L.GIANT_SKELETON]:   { hitpoints: 270, ani: ANI.gs,         stepsize: 8, lineofsight: 20, damage: 60, fireFrequency: 7 },
  [L.TOWER1]:           { hitpoints: 100, ani: ANI.food,       stepsize: 0, lineofsight: 10, damage: 0,  fireFrequency: 5 },
};

// prettier-ignore
const WEAPON: Record<number, Row> = {
  [W.KNIFE]:             { hitpoints: 6,    act: Act.FIRE, ani: ANI.kni,      stepsize: 5,  lineofsight: 7,   damage: 6 },
  [W.BONE]:              { hitpoints: 5,    act: Act.FIRE, ani: ANI.kni,      stepsize: 6,  lineofsight: 6,   damage: 5 },
  [W.ROCK]:              { hitpoints: 4,    act: Act.FIRE, ani: ANI.rock,     stepsize: 5,  lineofsight: 8,   damage: 4 },
  [W.ARROW]:             { hitpoints: 5,    act: Act.FIRE, ani: ANI.arrow,    stepsize: 8,  lineofsight: 12,  damage: 5 },
  [W.FIRE_ARROW]:        { hitpoints: 7,    act: Act.FIRE, ani: ANI.arrow,    stepsize: 8,  lineofsight: 12,  damage: 7 },
  [W.FIREBALL]:          { hitpoints: 8,    act: Act.FIRE, ani: ANI.arrow,    stepsize: 6,  lineofsight: 7,   damage: 10 },
  [W.TREE]:              { hitpoints: 50,   act: Act.SIT,  ani: ANI.tree,     stepsize: 0,  lineofsight: 1,   damage: 0 },
  [W.METEOR]:            { hitpoints: 12,   act: Act.FIRE, ani: ANI.arrow,    stepsize: 7,  lineofsight: 9,   damage: 12 },
  [W.SPRINKLE]:          { hitpoints: 1,    act: Act.FIRE, ani: ANI.kni,      stepsize: 6,  lineofsight: 10,  damage: 1 },
  [W.BLOOD]:             { hitpoints: 0,    act: Act.DIE,  ani: ANI.blood,    stepsize: 0,  lineofsight: 1,   damage: 0 },
  [W.BLOB]:              { hitpoints: 1,    act: Act.FIRE, ani: ANI.blob1,    stepsize: 2,  lineofsight: 11,  damage: 1, fireFrequency: 2 },
  [W.LIGHTNING]:         { hitpoints: 60,   act: Act.FIRE, ani: ANI.arrow,    stepsize: 9,  lineofsight: 13,  damage: 6 },
  [W.GLOW]:              { hitpoints: 50,   act: Act.SIT,  ani: ANI.glowGrow, stepsize: 0,  lineofsight: 1,   damage: 0 },
  [W.WAVE]:              { hitpoints: 50,   act: Act.FIRE, ani: ANI.arrow,    stepsize: 6,  lineofsight: 3,   damage: 16 },
  // The original sets WAVE3's act type twice and never WAVE2's, leaving it ACT_RANDOM.
  [W.WAVE2]:             { hitpoints: 50,   act: Act.RANDOM, ani: ANI.arrow,  stepsize: 4,  lineofsight: 4,   damage: 12 },
  [W.WAVE3]:             { hitpoints: 50,   act: Act.FIRE, ani: ANI.arrow,    stepsize: 3,  lineofsight: 6,   damage: 10 },
  [W.CIRCLE_PROTECTION]: { hitpoints: 50,   act: Act.SIT,  ani: ANI.food,     stepsize: 1,  lineofsight: 110, damage: 0 },
  [W.HAMMER]:            { hitpoints: 10,   act: Act.FIRE, ani: ANI.arrow,    stepsize: 6,  lineofsight: 5,   damage: 9 },
  [W.DOOR]:              { hitpoints: 5000, act: Act.SIT,  ani: ANI.door,     stepsize: 0,  lineofsight: 1,   damage: 0 },
  [W.BOULDER]:           { hitpoints: 50,   act: Act.FIRE, ani: ANI.none,     stepsize: 10, lineofsight: 5,   damage: 25 },
};

const TREASURE: Record<number, Row> = {
  [T.STAIN]: { act: Act.CONTROL, ani: ANI.blood },
  [T.DRUMSTICK]: { hitpoints: 10, act: Act.CONTROL, ani: ANI.food, stepsize: 5 },
  [T.GOLD_BAR]: { hitpoints: 1000, act: Act.CONTROL, ani: ANI.food },
  [T.SILVER_BAR]: { hitpoints: 100, act: Act.CONTROL, ani: ANI.food },
  [T.MAGIC_POTION]: { act: Act.CONTROL, ani: ANI.food },
  [T.INVIS_POTION]: { act: Act.CONTROL, ani: ANI.food },
  [T.INVULNERABLE_POTION]: { act: Act.CONTROL, ani: ANI.food },
  [T.FLIGHT_POTION]: { act: Act.CONTROL, ani: ANI.food },
  [T.EXIT]: { act: Act.CONTROL, ani: ANI.food },
  [T.TELEPORTER]: { act: Act.CONTROL, ani: ANI.food },
  [T.LIFE_GEM]: { act: Act.CONTROL, ani: ANI.food },
  [T.KEY]: { act: Act.CONTROL, ani: ANI.food },
  [T.SPEED_POTION]: { act: Act.CONTROL, ani: ANI.food },
};

const GENERATOR: Record<number, Row> = {
  [GeneratorFamily.TENT]: { hitpoints: 100, act: Act.GENERATE, ani: ANI.tent },
  [GeneratorFamily.TOWER]: { act: Act.GENERATE, ani: ANI.tower },
  [GeneratorFamily.BONES]: { act: Act.GENERATE, ani: ANI.none, damage: 2 },
  [GeneratorFamily.TREEHOUSE]: { act: Act.GENERATE, ani: ANI.none },
};

const FX: Record<number, Row> = {
  [FxFamily.EXPAND]: { ani: ANI.expand8 },
  [FxFamily.GHOST_SCARE]: { ani: ANI.expand8 },
  [FxFamily.BOMB]: { ani: ANI.bomb1 },
  [FxFamily.EXPLOSION]: { ani: ANI.explosion1 },
  [FxFamily.FLASH]: { ani: ANI.expand8 },
  [FxFamily.MAGIC_SHIELD]: { hitpoints: 100, ani: ANI.kni, damage: 10 },
  [FxFamily.KNIFE_BACK]: { ani: ANI.kni },
  [FxFamily.BOOMERANG]: { hitpoints: 50, ani: ANI.ani16, damage: 8 },
  [FxFamily.CLOUD]: { ani: ANI.cloud, stepsize: 4, damage: 20 },
  [FxFamily.MARKER]: { ani: ANI.marker },
  [FxFamily.CHAIN]: { ani: ANI.arrow, stepsize: 12, lineofsight: 15 },
  [FxFamily.DOOR_OPEN]: { ani: ANI.doorOpen },
};

const TABLES: Record<number, Record<number, Row>> = {
  [Order.LIVING]: LIVING,
  [Order.WEAPON]: WEAPON,
  [Order.TREASURE]: TREASURE,
  [Order.GENERATOR]: GENERATOR,
  [Order.FX]: FX,
};

export function typeInfo(order: number, family: number): TypeInfo {
  const row = TABLES[order]?.[family] ?? {};
  return {
    hitpoints: row.hitpoints ?? 0,
    act: row.act ?? Act.RANDOM,
    ani: row.ani ?? null,
    stepsize: row.stepsize ?? 0,
    lineofsight: row.lineofsight ?? 0,
    damage: row.damage ?? 0,
    fireFrequency: row.fireFrequency ?? 0,
  };
}
