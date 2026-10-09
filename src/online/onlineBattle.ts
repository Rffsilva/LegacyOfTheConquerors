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
  /** Frames received but not played yet. */
  private readonly frames = new Map<number, Frame>();
  /**
   * Every tick up to here is known: received, or covered by the server's log (which leaves out
   * ticks where nothing changed). We never play past it, never guessing a missing tick empty.
   */
  private known = 0;
  private lastHeld = -1;
  private heard = performance.now();
  private resyncAsked = -Infinity;

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
    return this.known - this.lockstep.tick;
  }

  /** How long since the server last sent anything for this battle. */
  get quietMs(): number {
    return performance.now() - this.heard;
  }

  /**
   * New frames from the server. Live ticks come one per tick, none skipped; the log (with
   * `now`, the last tick it covers) only has the ticks where something changed.
   */
  add(frames: readonly Frame[], now?: number): void {
    for (const frame of frames) if (frame.n > this.lockstep.tick) this.frames.set(frame.n, frame);
    if (now !== undefined) this.known = Math.max(this.known, now);
    while (this.frames.has(this.known + 1)) this.known++;
    this.heard = performance.now();
    // A tick went missing on the way (a dropped connection): ask for the log to fill the gap.
    if (this.frames.size && Math.max(...this.frames.keys()) > this.known + 1 && performance.now() - this.resyncAsked > 2000) {
      this.resyncAsked = performance.now();
      this.campaign.joinBattle();
    }
  }

  /** Plays the next tick, if we know it. */
  playOne(): boolean {
    if (this.backlog <= 0 || this.world.outcome) return false;
    const n = this.lockstep.tick + 1;
    const frame = this.frames.get(n) ?? { n }; // not received: the log says nothing changed
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
