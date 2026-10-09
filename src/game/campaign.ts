// Campaign state and the team-management rules from picker.cpp and screen::endgame: hiring,
// training, battle rewards and levelling. Pure logic, no UI.

import { LivingFamily as L, Order } from '../data/objects.ts';
import { calculateExp, calculateLevel, COST_LIST, Guy, STAT_COSTS } from '../sim/guy.ts';
import { specialName } from '../sim/specialNames.ts';
import type { Outcome, World } from '../sim/world.ts';

export const MAX_TEAM = 24;
export const STARTING_CASH = 5000;
/** screen.cpp: time bonus pool and how much each scenario level adds to it. */
const TIME_BONUS = 5000;
const LEVEL_BONUS = 120;
/** picker.cpp RAISE: stat improvements cost (points above base) ^ 1.85. */
const RAISE = 1.85;

/** Families you can hire, in the original's order (picker.cpp allowable_guys). */
export const HIREABLE: readonly number[] = [
  L.SOLDIER, L.BARBARIAN, L.ELF, L.ARCHER, L.MAGE, L.CLERIC, L.THIEF, L.DRUID,
  L.ORC, L.SKELETON, L.FIREELEMENTAL, L.SMALL_SLIME, L.FAERIE, L.GHOST,
];

export type Stat = 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'armor' | 'level';
export const STATS: readonly Stat[] = ['strength', 'dexterity', 'constitution', 'intelligence', 'armor', 'level'];

/** Base stats per family that costs are measured from (picker.cpp statlist). */
// prettier-ignore
const STAT_LIST: readonly (readonly number[])[] = [
  [12, 6, 12, 8, 9, 1], [5, 9, 5, 12, 8, 1], [6, 12, 6, 10, 5, 1], [4, 6, 4, 16, 5, 1], [9, 6, 9, 6, 9, 1],
  [6, 7, 6, 14, 7, 1], [14, 5, 30, 6, 16, 1], [3, 8, 3, 8, 4, 1], [18, 2, 18, 4, 8, 1], [18, 2, 18, 4, 8, 1],
  [18, 2, 18, 4, 8, 1], [9, 12, 12, 10, 5, 1], [6, 12, 18, 10, 15, 1], [7, 8, 6, 12, 7, 1], [16, 4, 14, 2, 11, 1],
  [16, 4, 14, 2, 11, 1], [14, 5, 14, 8, 8, 1], [4, 6, 4, 16, 5, 1],
];

export function baseStat(family: number, stat: Stat): number {
  return (STAT_LIST[family] ?? STAT_LIST[0])[STATS.indexOf(stat)];
}

export interface Campaign {
  version: 1;
  name: string;
  money: number;
  score: number;
  team: Guy[];
  /** Scenario number the next battle takes place in. */
  scenario: number;
  /** Scenario numbers already won. */
  completed: number[];
  /** Online campaigns: fields teammates have opened up, which can be fought too. */
  open?: number[];
  /** Hires per family, for default names like SOLDIER3. */
  hired: Record<number, number>;
  difficulty: number;
}

export function newCampaign(name = 'SAVED GAME', difficulty = 1): Campaign {
  return { version: 1, name, money: STARTING_CASH, score: 0, team: [], scenario: 1, completed: [], hired: {}, difficulty };
}

// --- Costs -------------------------------------------------------------------------

function statPrice(family: number, stat: Stat, value: number): number {
  const above = value - baseStat(family, stat);
  return Math.trunc(Math.pow(above, RAISE) * (STAT_COSTS[family] ?? STAT_COSTS[0])[STATS.indexOf(stat)]);
}

/** Price of a new recruit with the given stats (picker.cpp calculate_cost()). */
export function hireCost(guy: Guy): number {
  let cost = COST_LIST[guy.family] ?? 0;
  for (const stat of STATS) cost += statPrice(guy.family, stat, Math.max(guy[stat], baseStat(guy.family, stat)));
  return cost + calculateExp(guy.level);
}

/**
 * Price of training `current` up to `proposed` (picker.cpp calculate_cost(oldguy)): the extra
 * stat cost, plus buying any experience a new level needs beyond what they've earned.
 */
export function trainingCost(current: Guy, proposed: Guy): number {
  let cost = 0;
  for (const stat of STATS) {
    cost += statPrice(current.family, stat, Math.max(proposed[stat], current[stat])) - statPrice(current.family, stat, current[stat]);
  }
  const needed = calculateExp(Math.max(proposed.level, current.level));
  if (needed > current.exp) cost += (needed - current.exp) * (Math.max(proposed.level, current.level) - 1);
  return Math.max(0, cost);
}

/** A fresh recruit of a family, named like the original (SOLDIER1, SOLDIER2...). */
export function recruit(campaign: Campaign, family: number): Guy {
  const guy = new Guy(family);
  guy.name = `${guy.name}${(campaign.hired[family] ?? 0) + 1}`.slice(0, 11);
  return guy;
}

export type ActionResult = { ok: true } | { ok: false; reason: string };

export function hire(campaign: Campaign, guy: Guy): ActionResult {
  if (campaign.team.length >= MAX_TEAM) return { ok: false, reason: `Your team is full (${MAX_TEAM}).` };
  const cost = hireCost(guy);
  if (cost > campaign.money) return { ok: false, reason: 'Not enough cash.' };
  campaign.money -= cost;
  guy.exp = calculateExp(guy.level);
  campaign.team.push(guy);
  campaign.hired[guy.family] = (campaign.hired[guy.family] ?? 0) + 1;
  return { ok: true };
}

export function train(campaign: Campaign, index: number, proposed: Guy): ActionResult {
  const current = campaign.team[index];
  if (!current) return { ok: false, reason: 'No such team member.' };
  const cost = trainingCost(current, proposed);
  if (cost > campaign.money) return { ok: false, reason: 'Not enough cash.' };
  campaign.money -= cost;
  for (const stat of STATS) current[stat] = Math.max(current[stat], proposed[stat]);
  current.exp = Math.max(current.exp, calculateExp(current.level));
  current.name = proposed.name || current.name;
  return { ok: true };
}

export function dismiss(campaign: Campaign, index: number): void {
  campaign.team.splice(index, 1);
}

/** The changes the barracks makes to a team. */
export interface TeamOps {
  hire(guy: Guy): ActionResult;
  train(index: number, proposed: Guy): ActionResult;
  dismiss(index: number): ActionResult;
  setLeader(index: number): ActionResult;
}

/** Team changes for a campaign kept on this device: apply them, then `saved()`. */
export function localTeamOps(campaign: Campaign, saved: () => void): TeamOps {
  const then = <T>(result: T): T => (saved(), result);
  return {
    hire: (guy) => then(hire(campaign, guy)),
    train: (index, proposed) => then(train(campaign, index, proposed)),
    dismiss: (index) => then((dismiss(campaign, index), { ok: true })),
    setLeader: (index) => then((setLeader(campaign, index), { ok: true })),
  };
}

/** Who the player controls when a battle starts: the chosen leader, or else the first in the team. */
export function leaderIndex(campaign: Campaign): number {
  return Math.max(0, campaign.team.findIndex((g) => g.leader));
}

export function setLeader(campaign: Campaign, index: number): void {
  campaign.team.forEach((g, i) => (g.leader = i === index));
}

// --- Battles -------------------------------------------------------------------------

export interface LevelUp {
  name: string;
  from: number;
  to: number;
  newAbility?: string;
}

export interface BattleReport {
  outcome: Outcome;
  alreadyWon: boolean;
  score: number;
  cash: number;
  timeBonus: number;
  fallen: string[];
  levelUps: LevelUp[];
  nextScenario: number;
}

/**
 * Squad for a battle: copies, so a lost battle leaves the campaign untouched. Pass the same array
 * to applyBattle. The leader is always marked, so the battle starts with whoever the barracks shows.
 */
export function squadFor(campaign: Campaign): Guy[] {
  const squad = campaign.team.map((g) => g.clone());
  const leader = squad[leaderIndex(campaign)];
  if (leader) leader.leader = true;
  return squad;
}

/** The counters a squad member's record gains in battle. */
export const RECORD_FIELDS = ['exp', 'kills', 'levelKills', 'totalDamage', 'totalHits', 'totalShots'] as const;
export type RecordField = (typeof RECORD_FIELDS)[number];

/** A squad member still standing after a battle: who they are and their record afterwards. */
export type Survivor = { from: number } & Record<RecordField, number>;

/** What a battle did to the squad: small enough to send to an online campaign's server. */
export interface BattleSummary {
  outcome: Outcome;
  /** The player's score and how long the battle took, for the cash and time bonus. */
  score: number;
  ticks: number;
  /**
   * Who is still standing: `from` is their index in the squad. A slime that split comes back
   * twice from the same member, as in the original, where each half joined the team.
   */
  survivors: Survivor[];
}

/** A battle's summary for one squad; online, `player` picks whose squad (and score) it is. */
export function summarizeBattle(world: World, squad: readonly Guy[], player?: number): BattleSummary {
  const outcome = world.outcome ?? { result: 'defeat', reason: 'Battle abandoned.' };
  // Survivors are the squad's records still standing (plus split-off slimes with a copied record).
  const ours = (o: World['oblist'][number]) => (player === undefined ? o.teamNum === 0 : o.squad === player);
  const standing = new Set(world.oblist.filter((o) => !o.dead && o.order === Order.LIVING && o.myguy && ours(o)).map((o) => o.myguy!));
  const survivors: Survivor[] = [];
  for (const guy of standing) {
    let from = squad.indexOf(guy);
    if (from < 0) from = squad.findIndex((g) => g.family === guy.family && g.name === guy.name);
    if (from < 0) continue;
    const survivor = { from } as Survivor;
    for (const field of RECORD_FIELDS) survivor[field] = guy[field];
    survivors.push(survivor);
  }
  const score = player === undefined ? world.score[0] : (world.playerScore[player] ?? 0);
  return { outcome, score, ticks: world.ticks, survivors };
}

/**
 * Applies a finished battle to the campaign (screen::endgame + save_game). Victory banks the
 * score, pays out cash and a time bonus, levels up survivors and loses the fallen. Defeat
 * leaves everything as it was before the battle; a retreat only moves the campaign.
 */
export function applyBattle(campaign: Campaign, world: World, squad: readonly Guy[], par: number): BattleReport {
  return applyBattleSummary(campaign, summarizeBattle(world, squad), squad, par);
}

/**
 * Like applyBattle, from a summary. `squad` is the team as it went into battle (what the
 * survivors' indices refer to); the new team keeps its order.
 */
export function applyBattleSummary(campaign: Campaign, summary: BattleSummary, squad: readonly Guy[], par: number): BattleReport {
  const outcome = summary.outcome;
  const alreadyWon = campaign.completed.includes(campaign.scenario);
  const report: BattleReport = { outcome, alreadyWon, score: 0, cash: 0, timeBonus: 0, fallen: [], levelUps: [], nextScenario: campaign.scenario };

  if (outcome.result === 'retreat') {
    campaign.scenario = report.nextScenario = outcome.exitTo;
    return report;
  }
  if (outcome.result !== 'victory') return report;

  const { score, ticks } = summary;
  let bonus = Math.trunc((score * (TIME_BONUS + par * LEVEL_BONUS - ticks)) / (TIME_BONUS + Math.trunc((par * LEVEL_BONUS) / 2)));
  if (bonus < 0 || ticks > TIME_BONUS || alreadyWon) bonus = 0;
  report.score = score;
  report.cash = score * 2 + bonus;
  report.timeBonus = bonus;
  campaign.score += score;
  campaign.money += report.cash;

  const survivors: Guy[] = [];
  for (const record of [...summary.survivors].sort((a, b) => a.from - b.from)) {
    const before = squad[record.from];
    if (!before) continue;
    const guy = before.clone();
    for (const field of RECORD_FIELDS) guy[field] = record[field];
    survivors.push(guy);
  }
  const alive = new Set(summary.survivors.map((s) => s.from));
  report.fallen = squad.filter((_, i) => !alive.has(i)).map((g) => g.name);
  for (const guy of survivors) {
    const level = calculateLevel(guy.exp);
    if (level !== guy.level) {
      const up: LevelUp = { name: guy.name, from: guy.level, to: level };
      const slot = (level - 1) / 3 + 1;
      if (level > guy.level && Number.isInteger(slot) && slot <= 4 && specialName(guy.family, slot) !== 'NONE') {
        up.newAbility = specialName(guy.family, slot);
      }
      report.levelUps.push(up);
      guy.level = level;
    }
  }
  campaign.team = survivors.slice(0, MAX_TEAM);

  if (!alreadyWon) campaign.completed.push(campaign.scenario);
  campaign.scenario = report.nextScenario = outcome.exitTo ?? campaign.scenario + 1;
  return report;
}

// --- Saving -------------------------------------------------------------------------

export function serialize(campaign: Campaign): string {
  return JSON.stringify(campaign);
}

export function deserialize(json: string): Campaign {
  const data = JSON.parse(json) as Campaign;
  data.team = data.team.map((g) => Object.assign(new Guy(g.family), g));
  return data;
}
