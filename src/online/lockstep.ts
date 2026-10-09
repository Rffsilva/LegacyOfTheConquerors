// Online battles in lockstep: every player's device runs the same battle, and the server only
// sets the pace and relays inputs. A battle is fully described by its setup plus, for every
// tick, which inputs changed and who joined or left; replaying that gives the identical world
// on every device (the simulation is deterministic), including for someone who joins late.

import type { Guy } from '../sim/guy.ts';
import { NO_INPUT, type PlayerInput } from '../sim/player.ts';
import { World, type WorldOptions } from '../sim/world.ts';
import type { GuyData } from './protocol.ts';
import { toGuy } from './room.ts';

export interface BattleSetup {
  id: string;
  scenario: number;
  seed: number;
  difficulty: number;
  /** Fields the squads may retreat to, and whether this one is already cleared. */
  completed: number[];
  alreadyWon: boolean;
  /** Milliseconds per tick: everyone plays at the same speed. */
  tickMs: number;
  /** The squads that started, one per player; the player number is the position. */
  squads: GuyData[][];
  names: string[];
}

/** Changes to the battle's players, applied at the start of a tick. */
export type BattleEvent =
  | { t: 'join'; player: number; name: string; squad: GuyData[] }
  /** Away (left, or lost connection): their squad fights on under the computer. */
  | { t: 'leave'; player: number }
  | { t: 'return'; player: number };

/** What happens at tick `n`: inputs that changed ([player, code]) and player events. */
export interface Frame {
  n: number;
  inputs?: [number, number][];
  events?: BattleEvent[];
}

// --- Inputs as small numbers ---------------------------------------------------------

const RIGHT = 1;
const LEFT = 2;
const DOWN = 4;
const UP = 8;
const FIRE = 16;
const ALTERNATE = 32;
const SPECIAL = 64;
const SWITCH_UNIT = 128;
const CYCLE_SPECIAL = 256;
const YELL = 512;
/** Buttons that count once (pressed since the last tick), not while held. */
export const PRESSES = SPECIAL | SWITCH_UNIT | CYCLE_SPECIAL | YELL;

export function encodeInput(input: PlayerInput): number {
  return (
    (input.moveX > 0 ? RIGHT : 0) |
    (input.moveX < 0 ? LEFT : 0) |
    (input.moveY > 0 ? DOWN : 0) |
    (input.moveY < 0 ? UP : 0) |
    (input.fire ? FIRE : 0) |
    (input.alternate ? ALTERNATE : 0) |
    (input.special ? SPECIAL : 0) |
    (input.switchUnit ? SWITCH_UNIT : 0) |
    (input.cycleSpecial ? CYCLE_SPECIAL : 0) |
    (input.yell ? YELL : 0)
  );
}

export function decodeInput(code: number): PlayerInput {
  if (!code) return NO_INPUT;
  return {
    moveX: code & RIGHT ? 1 : code & LEFT ? -1 : 0,
    moveY: code & DOWN ? 1 : code & UP ? -1 : 0,
    fire: (code & FIRE) !== 0,
    alternate: (code & ALTERNATE) !== 0,
    special: (code & SPECIAL) !== 0,
    switchUnit: (code & SWITCH_UNIT) !== 0,
    cycleSpecial: (code & CYCLE_SPECIAL) !== 0,
    yell: (code & YELL) !== 0,
  };
}

// --- Replaying a battle ----------------------------------------------------------------

/** Everything about a battle that isn't in its setup: the field itself. */
export type FieldOptions = Pick<WorldOptions, 'map' | 'objects' | 'scenarioType' | 'spriteInfo'>;

/** A battle being played (or replayed) one frame at a time. */
export class Lockstep {
  readonly world: World;
  readonly setup: BattleSetup;
  /** Each player's squad as it entered the battle, for the results. */
  readonly squads: Guy[][];
  /** The last tick played. */
  tick = 0;
  private codes: number[];

  constructor(setup: BattleSetup, field: FieldOptions) {
    this.setup = setup;
    this.squads = setup.squads.map((squad) => squad.map(toGuy));
    this.world = new World({
      ...field,
      seed: setup.seed,
      difficulty: setup.difficulty,
      completed: setup.completed,
      alreadyWon: setup.alreadyWon,
      squads: this.squads,
    });
    this.codes = this.squads.map(() => 0);
  }

  /** Plays the next tick. Frames must come in order, one per tick. */
  play(frame: Frame): void {
    if (frame.n !== this.tick + 1) throw new Error(`Expected tick ${this.tick + 1}, got ${frame.n}`);
    for (const event of frame.events ?? []) {
      if (event.t === 'join') {
        const squad = event.squad.map(toGuy);
        this.squads[event.player] = squad;
        this.world.addSquad(event.player, squad);
      } else {
        this.world.setPlayerActive(event.player, event.t === 'return');
      }
    }
    for (const [player, code] of frame.inputs ?? []) this.codes[player] = code;
    this.world.tick(this.squads.map((_, i) => decodeInput(this.codes[i] ?? 0)));
    this.tick = frame.n;
  }
}
