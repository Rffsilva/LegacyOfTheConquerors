// Special ability names per family and slot (screen.cpp). Slot 0 is unused; "NONE" marks an
// empty slot, which the AI treats as "fall back to special 1".

import { LivingFamily as L } from '../data/objects.ts';

type Names = Readonly<Record<number, readonly string[]>>;

export const SPECIAL_NAMES: Names = {
  [L.SOLDIER]: ['NONE', 'CHARGE', 'BOOMERANG', 'WHIRLWIND', 'DISARM'],
  [L.BARBARIAN]: ['NONE', 'HURL BOULDER', 'EXPLODING BOULDER'],
  [L.ELF]: ['NONE', 'ROCKS', 'BOUNCING ROCKS', 'LOTS OF ROCKS', 'MEGA ROCKS'],
  [L.ARCHER]: ['NONE', 'FIRE ARROWS', 'BARRAGE', 'EXPLODING BOLT'],
  [L.MAGE]: ['NONE', 'TELEPORT', 'WARP SPACE', 'FREEZE TIME', 'ENERGY WAVE', 'HEARTBURST'],
  [L.ARCHMAGE]: ['NONE', 'TELEPORT', 'HEARTBURST', 'SUMMON IMAGE', 'MIND CONTROL'],
  [L.CLERIC]: ['NONE', 'HEAL', 'RAISE UNDEAD', 'RAISE GHOST', 'RESURRECT'],
  [L.DRUID]: ['NONE', 'GROW TREE', 'SUMMON FAERIE', 'REVEAL', 'PROTECTION'],
  [L.THIEF]: ['NONE', 'DROP BOMB', 'CLOAK', 'TAUNT ENEMY', 'POISON CLOUD'],
  [L.GHOST]: ['NONE', 'SCARE'],
  [L.FIREELEMENTAL]: ['NONE', 'STARBURST'],
  [L.ORC]: ['NONE', 'HOWL', 'EAT CORPSE'],
  [L.SMALL_SLIME]: ['NONE', 'GROW'],
  [L.MEDIUM_SLIME]: ['NONE', 'GROW'],
  [L.SLIME]: ['NONE', 'SPLIT'],
  [L.SKELETON]: ['NONE', 'TUNNEL'],
};

/** Names used while the alternate (shift) key is held. */
export const ALTERNATE_NAMES: Names = {
  [L.MAGE]: ['NONE', 'TELEPORT MARKER'],
  [L.ARCHMAGE]: ['NONE', 'TELEPORT MARKER', 'CHAIN LIGHTNING', 'SUMMON ELEMENTAL'],
  [L.CLERIC]: ['NONE', 'MYSTIC MACE', 'TURN UNDEAD', 'TURN UNDEAD'],
  [L.THIEF]: ['NONE', 'NONE', 'NONE', 'CHARM OPPONENT'],
};

export function specialName(family: number, slot: number): string {
  return SPECIAL_NAMES[family]?.[slot] ?? 'NONE';
}

export function alternateName(family: number, slot: number): string {
  return ALTERNATE_NAMES[family]?.[slot] ?? 'NONE';
}
