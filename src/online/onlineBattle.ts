// The game's side of an online battle: plays the ticks the server sends (catching up first, if
// we joined late or dropped out for a while), and sends our own inputs when they change.

import { summarizeBattle, type BattleSummary } from '../game/campaign.ts';
import type { PlayerInput } from '../sim/player.ts';
import type { World } from '../sim/world.ts';
import { encodeInput, Lockstep, PRESSES, type FieldOptions, type Frame } from './lockstep.ts';
import type { OnlineCampaign } from './onlineCampaign.ts';
import type { ServerMessage } from './protocol.ts';

export type BattleMessage = Extract<ServerMessage, { t: 'battle' }>;

export class OnlineBattle {
  readonly lockstep: Lockstep;
  /** Our player number in this battle. */
  readonly you: number;
  private readonly campaign: OnlineCampaign;
  /** Frames received but not played yet (ticks without changes may be missing). */
  private readonly frames = new Map<number, Frame>();
  /** The last tick the server has issued that we know of. */
  private target = 0;
  private lastHeld = -1;
  private heard = performance.now();

  constructor(campaign: OnlineCampaign, message: BattleMessage, field: FieldOptions) {
    this.campaign = campaign;
    this.you = message.you;
    this.lockstep = new Lockstep(message.setup, field);
    this.add(message.frames, message.now);
  }

  get id(): string {
    return this.lockstep.setup.id;
  }

  get world(): World {
    return this.lockstep.world;
  }

  get tickMs(): number {
    return this.lockstep.setup.tickMs;
  }

  /** Ticks we know about but haven't played. */
  get backlog(): number {
    return this.target - this.lockstep.tick;
  }

  /** How long since the server last sent anything for this battle. */
  get quietMs(): number {
    return performance.now() - this.heard;
  }

  /** New frames from the server; `now` is the last tick issued, when frames skip empty ticks. */
  add(frames: readonly Frame[], now?: number): void {
    for (const frame of frames) {
      if (frame.n > this.lockstep.tick) this.frames.set(frame.n, frame);
      this.target = Math.max(this.target, frame.n);
    }
    if (now !== undefined) this.target = Math.max(this.target, now);
    this.heard = performance.now();
  }

  /** Plays the next tick, if the server has issued it. */
  playOne(): boolean {
    if (this.backlog <= 0 || this.world.outcome) return false;
    const n = this.lockstep.tick + 1;
    const frame = this.frames.get(n) ?? { n };
    this.frames.delete(n);
    this.lockstep.play(frame);
    return true;
  }

  /** Our input this frame: sent when what we hold changes, or a button was pressed. */
  input(input: PlayerInput): void {
    const code = encodeInput(input);
    const held = code & ~PRESSES;
    if (held === this.lastHeld && !(code & PRESSES)) return;
    this.lastHeld = held;
    this.campaign.sendInput(code);
  }

  /** Every player's results, by player number (everyone's device works out the same). */
  summaries(): (BattleSummary | null)[] {
    return this.lockstep.squads.map((squad, player) => (squad ? summarizeBattle(this.world, squad, player) : null));
  }
}
