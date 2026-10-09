// The Arena: a walled pit where waves of foes come in rounds, each harder than the last, for as
// long as the squad holds out. Every CHECKPOINT rounds the fighting stops and each player
// chooses: leave with the gold and experience earned so far, or fight on. A squad that falls
// before leaving loses the run's rewards (the team comes back as it went in).
//
// The rules run inside the simulation (World.rules), off the world's own random numbers, so an
// online arena plays out the same on every player's device.

import type { ScenarioAsset } from '../data/assets.ts';
import { LivingFamily as L, Order, SpecialFamily } from '../data/objects.ts';
import { GRID_SIZE } from '../data/tiles.ts';
import type { World, WorldRules } from '../sim/world.ts';
import { summarizeBattle, type BattleSummary } from './campaign.ts';

/** The arena's number among the fields (real fields are 1-999). */
export const ARENA_FIELD = 1000;
export const ARENA_ID = 'arena';
export const ARENA_TITLE = 'The Arena';
/** Rounds between the chances to leave. */
export const CHECKPOINT = 5;
/** A short breather between rounds, in ticks. */
const BREAK_TICKS = 50;
const FIRST_BREAK_TICKS = 30;
/** Most foes in one round. */
const MAX_FOES = 48;

export function isArena(field: number | string): boolean {
  return field === ARENA_FIELD || field === ARENA_ID;
}

/** The scenario id to load for a field number. */
export function fieldId(field: number): string {
  return isArena(field) ? ARENA_ID : `scen${field}`;
}

export type ArenaPhase = 'break' | 'fight' | 'checkpoint' | 'over';

/** Where one player stands in the run. */
export type ArenaStanding = 'fighting' | 'banked' | 'fallen';

export interface ArenaOptions {
  /**
   * Ticks players get to choose at a checkpoint before anyone undecided leaves (with their
   * rewards). 0 waits for ever (a single player can take their time).
   */
  decideTicks?: number;
}

export class ArenaRules implements WorldRules {
  /** The round being fought (or the last one, during a break). */
  round = 0;
  /** Rounds won so far. */
  cleared = 0;
  phase: ArenaPhase = 'break';
  /** Ticks left in a break, or to choose at a checkpoint. */
  timer = FIRST_BREAK_TICKS;
  /** What each player took home, by player number: set when they leave at a checkpoint. */
  readonly banked: (BattleSummary | null)[] = [];
  /** Players whose squad fell. */
  readonly fallen = new Set<number>();
  /** At a checkpoint: who has chosen, and whether to leave. */
  readonly choices = new Map<number, boolean>();
  private readonly decideTicks: number;

  constructor(options: ArenaOptions = {}) {
    this.decideTicks = options.decideTicks ?? 0;
  }

  standing(player: number): ArenaStanding {
    return this.banked[player] ? 'banked' : this.fallen.has(player) ? 'fallen' : 'fighting';
  }

  /** Players still in the run. */
  fighters(world: World): number[] {
    return world.players.map((_, i) => i).filter((p) => this.standing(p) === 'fighting' && world.squads[p]);
  }

  /** At a checkpoint: leave with the rewards (true), or fight on (false). */
  choose(world: World, player: number, leave: boolean): void {
    if (this.phase !== 'checkpoint' || this.standing(player) !== 'fighting') return;
    this.choices.set(player, leave);
    if (this.fighters(world).every((p) => this.choices.has(p))) this.resolve(world);
  }

  /** A player's results: what they banked, or nothing (their squad fell, or the run isn't over). */
  summary(world: World, player: number): BattleSummary | null {
    if (!world.squads[player]) return null;
    return this.banked[player] ?? { outcome: { result: 'defeat', reason: 'YOUR MEN FELL IN THE ARENA!' }, score: 0, ticks: world.ticks, survivors: [], arena: this.cleared };
  }

  tick(world: World): void {
    if (this.phase === 'over') return;
    for (const p of this.fighters(world)) {
      if (!hasUnits(world, p)) this.fallen.add(p);
    }
    if (!this.fighters(world).length) return this.end(world);

    switch (this.phase) {
      case 'break':
        if (--this.timer <= 0) this.startRound(world);
        break;
      case 'fight':
        if (world.remainingFoes(world.myTeam) === 0) this.roundWon(world);
        break;
      case 'checkpoint':
        if (this.decideTicks && --this.timer <= 0) this.resolve(world);
        break;
    }
  }

  private roundWon(world: World): void {
    this.cleared = this.round;
    // A breather: the squads get back a quarter of their strength (all of it at a checkpoint).
    heal(world, this.round % CHECKPOINT === 0 ? 1 : 0.25);
    if (this.round % CHECKPOINT === 0) {
      this.phase = 'checkpoint';
      this.timer = this.decideTicks;
      this.choices.clear();
      world.message(`ROUND ${this.round} WON! LEAVE WITH YOUR REWARDS, OR FIGHT ON?`);
      // Players who are away can't choose: they leave with what they earned.
      for (const p of this.fighters(world)) if (!world.players[p]?.active) this.choices.set(p, true);
      if (this.fighters(world).every((p) => this.choices.has(p))) this.resolve(world);
    } else {
      this.phase = 'break';
      this.timer = BREAK_TICKS;
      world.message(`ROUND ${this.round} WON!`);
    }
  }

  /** Everyone has chosen (or time is up): leavers take their rewards, the rest fight on. */
  private resolve(world: World): void {
    for (const p of this.fighters(world)) if (this.choices.get(p) !== false) this.bank(world, p);
    this.choices.clear();
    if (!this.fighters(world).length) return this.end(world);
    this.phase = 'break';
    this.timer = BREAK_TICKS;
  }

  /** A player leaves the arena with their squad's survivors and everything earned so far. */
  private bank(world: World, player: number): void {
    const summary = summarizeBattle(world, world.squads[player], world.multiplayer ? player : undefined);
    this.banked[player] = { ...summary, outcome: { result: 'victory' }, arena: this.cleared };
    for (const o of world.oblist) {
      if (!o.dead && (o.squad === player || o.owner?.squad === player)) o.dead = true;
    }
    world.setPlayerActive(player, false);
  }

  private end(world: World): void {
    this.phase = 'over';
    world.outcome ??= this.banked.some(Boolean) ? { result: 'victory' } : { result: 'defeat', reason: 'YOUR MEN FELL IN THE ARENA!' };
  }

  private startRound(world: World): void {
    this.round++;
    this.phase = 'fight';
    const players = Math.max(1, this.fighters(world).length);
    spawnWave(world, this.round, players);
    world.message(this.round % CHECKPOINT === 0 ? `ROUND ${this.round}: A CHAMPION ENTERS!` : `ROUND ${this.round}!`);
  }
}

/** Squads (and what they summoned) recover a share of their hit points and magic. */
function heal(world: World, share: number): void {
  for (const o of world.oblist) {
    if (o.dead || o.order !== Order.LIVING || o.squad < 0) continue;
    const s = o.stats;
    s.hitpoints = Math.min(s.maxHitpoints, s.hitpoints + Math.ceil(s.maxHitpoints * share));
    s.magicpoints = Math.min(s.maxMagicpoints, s.magicpoints + Math.ceil(s.maxMagicpoints * share));
  }
}

/** Does the player still have anyone standing (their squad, or what it summoned)? */
function hasUnits(world: World, player: number): boolean {
  return world.oblist.some((o) => !o.dead && o.order === Order.LIVING && o.squad === player);
}

// --- Waves ---------------------------------------------------------------------------

/** Who comes out of the gates, by the round they first appear. */
const FOES: readonly [round: number, family: number][] = [
  [1, L.ORC], [1, L.SOLDIER], [1, L.ARCHER],
  [3, L.SKELETON], [3, L.ELF], [3, L.THIEF], [4, L.FAERIE],
  [7, L.MAGE], [8, L.CLERIC], [8, L.BARBARIAN], [9, L.GHOST], [10, L.DRUID],
  [11, L.BIG_ORC], [12, L.FIREELEMENTAL], [16, L.GIANT_SKELETON], [18, L.GOLEM], [21, L.ARCHMAGE],
];
const CHAMPIONS = [L.BIG_ORC, L.GIANT_SKELETON, L.GOLEM, L.ARCHMAGE];

/** How many foes a round brings, and how strong they are. */
export function waveSize(round: number, players: number): { count: number; level: number } {
  const base = 1 + round + Math.floor((round * round) / 12);
  return {
    count: Math.min(MAX_FOES, Math.round(base * (1 + 0.6 * (players - 1)))),
    level: 1 + Math.floor((round - 1) / CHECKPOINT),
  };
}

function spawnWave(world: World, round: number, players: number): void {
  const { count, level } = waveSize(round, players);
  const pool = FOES.filter(([from]) => from <= round).map(([, family]) => family);
  for (let i = 0; i < count; i++) spawnFoe(world, pool[world.rng.random(pool.length)], level, '');
  if (round % CHECKPOINT === 0) {
    const champion = CHAMPIONS[(round / CHECKPOINT - 1) % CHAMPIONS.length];
    spawnFoe(world, champion, level + 1 + Math.floor(round / 10), 'CHAMPION');
  }
}

function spawnFoe(world: World, family: number, level: number, name: string): void {
  const foe = world.addOb(Order.LIVING, family);
  foe.teamNum = 1;
  foe.stats.level = level;
  if (name) foe.stats.name = name;
  foe.setDifficulty(level);
  const gate = GATES[world.rng.random(GATES.length)];
  foe.setxy(gate.x * GRID_SIZE, gate.y * GRID_SIZE);
  if (!foe.teleportRanged(40) && !foe.teleportRanged(96)) foe.teleport();
}

// --- The field -----------------------------------------------------------------------

const SIZE = 40;
const CENTER = SIZE / 2;
/** Where foes come in: just inside the middle of each wall (in tiles). */
const GATES = [
  { x: CENTER, y: 3 },
  { x: CENTER, y: SIZE - 3 },
  { x: 2, y: CENTER },
  { x: SIZE - 3, y: CENTER },
];

const T = {
  WALL: 0,
  WALL_SIDE: 4,
  FACE: 22,
  DIRT: 59,
  DIRT_DARK: 103,
  COBBLE: [72, 73, 75, 76],
  STEPS: 27,
  BRAZIER: 28,
  TORCH: 39,
  BOULDERS: [67, 89, 90, 91],
  PAVEMENT: 21,
};

/** The arena's map and starting places, built here rather than loaded from a scenario file. */
export function arenaScenario(): ScenarioAsset {
  const tiles: number[] = [];
  // A fixed pattern for the floor's variety, so the arena always looks the same.
  const noise = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - CENTER + 0.5, y - CENTER + 0.5);
      let tile: number = noise(x, y) % 7 === 0 ? T.DIRT_DARK : T.DIRT;
      if (d < 4.5) tile = T.COBBLE[noise(x, y) % 4];
      else if (d < 5.5) tile = T.PAVEMENT;
      if (y === 0 || y === SIZE - 1) tile = T.WALL;
      else if (x === 0 || x === SIZE - 1) tile = T.WALL_SIDE;
      else if (y === 1) tile = x % 7 === 3 ? T.TORCH : T.FACE;
      tiles.push(tile);
    }
  }
  const set = (x: number, y: number, tile: number) => (tiles[y * SIZE + x] = tile);
  // Steps where the gates are.
  for (let i = -1; i <= 1; i++) {
    set(CENTER + i, 2, T.STEPS);
    set(CENTER + i, SIZE - 2, T.STEPS);
    set(1, CENTER + i, T.STEPS);
    set(SIZE - 2, CENTER + i, T.STEPS);
  }
  // Braziers in the corners, boulders for a little cover.
  for (const [x, y] of [[2, 3], [SIZE - 3, 3], [2, SIZE - 3], [SIZE - 3, SIZE - 3]]) set(x, y, T.BRAZIER);
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) * Math.PI) / 4;
    const x = Math.round(CENTER + Math.cos(a) * 11);
    const y = Math.round(CENTER + Math.sin(a) * 11);
    set(x, y, T.BOULDERS[k % 4]);
    set(x + 1, y, T.BOULDERS[(k + 1) % 4]);
  }

  // Squads start in the middle: a block of team markers (enough for two full squads). Squads
  // take the last ones listed first, so the nearest to the centre come last.
  const spots: [number, number][] = [];
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) spots.push([dx, dy]);
  spots.sort(([ax, ay], [bx, by]) => bx * bx + by * by - (ax * ax + ay * ay) || ay - by || ax - bx);
  const objects: ScenarioAsset['objects'] = [];
  for (const [dx, dy] of spots) {
    objects.push({
      order: Order.SPECIAL,
      family: SpecialFamily.RESERVED_TEAM,
      x: (CENTER + dx) * GRID_SIZE,
      y: (CENTER + dy) * GRID_SIZE,
      team: 0,
      facing: 0,
      command: 0,
      level: 1,
      name: '',
    });
  }
  return {
    id: ARENA_ID,
    version: 8,
    grid: ARENA_ID,
    title: 'THE ARENA',
    type: 0,
    par: 1,
    objects,
    text: [
      'Waves of foes, each round harder than the last.',
      `Every ${CHECKPOINT} rounds, leave with the gold and experience you have earned, or fight on.`,
      'Fall before you leave, and the run earns you nothing.',
    ],
    map: { width: SIZE, height: SIZE, tiles },
  };
}
