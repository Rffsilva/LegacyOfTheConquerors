// A persistent squad member (guy.cpp) plus the economy tables from picker.cpp that its value
// depends on.

import { LivingFamily as L } from '../data/objects.ts';
import { idiv } from './math.ts';

/** Exponent on stat improvements when pricing them (picker.cpp RAISE). */
const RAISE = 1.85;

/** Base hire cost per family (picker.cpp costlist). */
export const COST_LIST: readonly number[] = [
  250, 150, 350, 450, 300, 400, 1500, 350, 1500, 1500, 1500, 400, 1000, 350, 700, 1500, 350, 450,
];

/** Cost multipliers for STR, DEX, CON, INT, ARMOR, LEVEL per family (picker.cpp statcosts). */
// prettier-ignore
export const STAT_COSTS: readonly (readonly number[])[] = [
  [6, 10, 6, 25, 50, 200], [25, 6, 12, 10, 50, 200], [15, 6, 9, 10, 50, 200], [20, 15, 16, 6, 50, 200],
  [6, 6, 16, 25, 50, 200], [15, 15, 9, 6, 50, 200], [15, 15, 12, 15, 50, 200], [25, 6, 12, 15, 50, 200],
  [20, 20, 16, 20, 50, 200], [20, 20, 16, 20, 50, 200], [20, 20, 16, 20, 50, 200], [15, 6, 9, 10, 50, 200],
  [20, 20, 16, 20, 45, 200], [15, 15, 9, 6, 50, 200], [8, 15, 9, 40, 50, 200], [8, 15, 9, 40, 50, 200],
  [8, 10, 5, 35, 50, 200], [30, 20, 25, 7, 55, 200],
];

interface BaseStats {
  name: string;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  armor: number;
}

const BASE: Record<number, BaseStats> = {
  [L.SOLDIER]: { name: 'SOLDIER', strength: 12, dexterity: 6, constitution: 12, intelligence: 8, armor: 9 },
  [L.ELF]: { name: 'ELF', strength: 5, dexterity: 9, constitution: 5, intelligence: 12, armor: 8 },
  [L.ARCHER]: { name: 'ARCHER', strength: 6, dexterity: 12, constitution: 6, intelligence: 10, armor: 5 },
  [L.MAGE]: { name: 'MAGE', strength: 4, dexterity: 6, constitution: 4, intelligence: 16, armor: 5 },
  [L.ARCHMAGE]: { name: 'ARCHMAGE', strength: 8, dexterity: 12, constitution: 8, intelligence: 32, armor: 10 },
  [L.SKELETON]: { name: 'SKELETON', strength: 9, dexterity: 6, constitution: 9, intelligence: 6, armor: 9 },
  [L.CLERIC]: { name: 'CLERIC', strength: 6, dexterity: 7, constitution: 6, intelligence: 14, armor: 7 },
  [L.FIREELEMENTAL]: { name: 'ELEMENTAL', strength: 14, dexterity: 5, constitution: 30, intelligence: 6, armor: 16 },
  [L.FAERIE]: { name: 'FAERIE', strength: 3, dexterity: 8, constitution: 3, intelligence: 8, armor: 4 },
  [L.SLIME]: { name: 'SLIME', strength: 30, dexterity: 2, constitution: 30, intelligence: 4, armor: 20 },
  [L.SMALL_SLIME]: { name: 'SLIME', strength: 18, dexterity: 2, constitution: 18, intelligence: 4, armor: 8 },
  [L.MEDIUM_SLIME]: { name: 'SLIME', strength: 24, dexterity: 2, constitution: 24, intelligence: 4, armor: 14 },
  [L.THIEF]: { name: 'THIEF', strength: 9, dexterity: 12, constitution: 12, intelligence: 10, armor: 5 },
  [L.GHOST]: { name: 'GHOST', strength: 6, dexterity: 12, constitution: 18, intelligence: 10, armor: 15 },
  [L.DRUID]: { name: 'DRUID', strength: 7, dexterity: 8, constitution: 6, intelligence: 12, armor: 7 },
  [L.ORC]: { name: 'ORC', strength: 16, dexterity: 4, constitution: 14, intelligence: 2, armor: 11 },
  [L.BIG_ORC]: { name: 'ORCER', strength: 16, dexterity: 4, constitution: 14, intelligence: 2, armor: 11 },
  [L.BARBARIAN]: { name: 'BARBARIAN', strength: 14, dexterity: 5, constitution: 14, intelligence: 8, armor: 8 },
};
const UNKNOWN: BaseStats = { name: 'UNKNOWN', strength: 12, dexterity: 6, constitution: 12, intelligence: 8, armor: 6 };

export class Guy {
  name: string;
  family: number;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  armor: number;
  level = 1;
  exp = 0;
  kills = 0;
  levelKills = 0;
  totalDamage = 0;
  totalHits = 0;
  totalShots = 0;
  teamnum = 0;

  constructor(family: number) {
    const base = BASE[family] ?? UNKNOWN;
    this.family = BASE[family] ? family : L.SOLDIER;
    this.name = base.name;
    this.strength = base.strength;
    this.dexterity = base.dexterity;
    this.constitution = base.constitution;
    this.intelligence = base.intelligence;
    this.armor = base.armor;
  }

  clone(): Guy {
    return Object.assign(new Guy(this.family), this);
  }

  /** What this character is worth; dying leaves a life gem worth 3/8 of it (guy::query_heart_value). */
  heartValue(): number {
    const normal = new Guy(this.family);
    const costs = STAT_COSTS[this.family] ?? STAT_COSTS[0];
    const stats = [
      this.strength - normal.strength,
      this.dexterity - normal.dexterity,
      this.constitution - normal.constitution,
      this.intelligence - normal.intelligence,
      this.armor - normal.armor,
    ];
    let cost = 0;
    stats.forEach((diff, i) => (cost += Math.trunc(Math.pow(Math.max(diff, 0), RAISE) * costs[i])));
    return cost + (COST_LIST[this.family] ?? 0);
  }
}

/** Experience needed to reach a level (picker.cpp calculate_exp). */
export function calculateExp(level: number): number {
  let exp = 0;
  for (let l = 2; l <= level; l++) exp += l === 2 ? 8000 : idiv(8000 * (l + 10), 10);
  return exp;
}

/** Level reached with a given amount of experience (picker.cpp calculate_level). */
export function calculateLevel(experience: number): number {
  let result = 1;
  while (calculateExp(result) <= experience) result++;
  return result - 1;
}
