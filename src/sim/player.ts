// A human player steering one squad member (view.cpp input / continuous_input). Input is
// handed in once per tick so play stays deterministic and replayable.

import { Order } from '../data/objects.ts';
import { aniFrame } from './animations.ts';
import { Action, Act, Ani, Bit, Command, NUM_SPECIALS } from './constants.ts';
import { specialName } from './specialNames.ts';
import type { Walker } from './walker.ts';
import type { World } from './world.ts';

export interface PlayerInput {
  /** Held direction, each -1..1. */
  moveX: number;
  moveY: number;
  /** Held: keep attacking. */
  fire: boolean;
  /** Held: the "shifter" that selects a special's alternate form. */
  alternate: boolean;
  /** Pressed since the last tick. */
  special: boolean;
  switchUnit: boolean;
  cycleSpecial: boolean;
  /** "Yo!": call squad mates to follow. With `alternate`, toggles defend mode instead. */
  yell: boolean;
}

export const NO_INPUT: PlayerInput = {
  moveX: 0,
  moveY: 0,
  fire: false,
  alternate: false,
  special: false,
  switchUnit: false,
  cycleSpecial: false,
  yell: false,
};

export class PlayerController {
  readonly world: World;
  readonly num: number;
  readonly team: number;
  control: Walker | null = null;
  /** Online battles: false while the player is away, their squad left to the computer. */
  active = true;

  constructor(world: World, num = 0, team = 0) {
    this.world = world;
    this.num = num;
    this.team = team;
  }

  /** Applies one tick of input. Returns false once nobody is left to control. */
  update(input: PlayerInput): boolean {
    if (!this.active) {
      this.release();
      return this.hasSquad();
    }
    const previous = this.control;
    if (!this.ensureControl()) return false;
    let c = this.control!;

    // Discrete actions (viewscreen::input).
    if (input.switchUnit && !input.alternate) {
      this.switchUnit();
      c = this.control!;
    }
    if (input.cycleSpecial) this.cycleSpecial(c);
    if (input.yell) {
      if (input.alternate) this.toggleDefend(c);
      else if (!c.yoDelay) this.yell(c);
    }
    if (c !== previous) c.stats.clearCommand();

    // Held controls (viewscreen::continuous_input).
    if (c.bonusRounds) {
      c.bonusRounds--;
      if (c.lastx || c.lasty) c.walkLast();
    }
    if (c.yoDelay > 0) c.yoDelay--;
    if (c.aniType !== Ani.WALK) c.animate();
    if (c.stats.frozenDelay) {
      c.stats.frozenDelay--;
      return true;
    }
    if (c.stats.commands.length) return true;

    c.shifterDown = input.alternate ? 1 : 0;
    if (input.special) c.special();
    const dx = Math.sign(input.moveX);
    const dy = Math.sign(input.moveY);
    if (dx || dy) {
      c.walkstep(dx, dy);
    } else if (c.stats.hasFlag(Bit.ANIMATE)) {
      c.cycle++;
      if (aniFrame(c.ani, c.curdir, c.cycle) === -1) c.cycle = 0;
      c.setFrame(aniFrame(c.ani, c.curdir, c.cycle));
    }
    if (input.fire) c.initFire();
    return true;
  }

  /**
   * Picks someone to control if we have nobody: the squad leader, other squad members, then any
   * ally. Online, only our own squad: friends' units are theirs.
   */
  private ensureControl(): boolean {
    const c = this.control;
    if (c && !c.dead) {
      if (c.user === -1) this.take(c);
      return true;
    }
    const livings = this.world.oblist.filter((o) => !o.dead && o.order === Order.LIVING);
    const next = this.world.multiplayer
      ? (livings.find((o) => o.user === -1 && o.myguy?.leader && o.squad === this.num) ?? livings.find((o) => o.user === -1 && o.squad === this.num))
      : livings.find((o) => o.user === -1 && o.myguy?.leader && o.teamNum === this.team) ??
      livings.find((o) => o.user === -1 && o.myguy && o.teamNum === this.team) ??
      livings.find((o) => o.user === -1 && o.teamNum === this.team) ??
      livings.find((o) => o.myguy);
    if (!next) {
      this.control = null;
      return false;
    }
    this.take(next);
    return true;
  }

  /** Hands our unit back to the AI, keeping nothing under control. */
  private release(): void {
    const current = this.control;
    if (current && current.user === this.num) {
      current.restoreActType();
      if (current.actType === Act.CONTROL) current.setActType(Act.RANDOM);
      current.user = -1;
    }
    this.control = null;
  }

  private hasSquad(): boolean {
    return this.world.oblist.some((o) => !o.dead && o.order === Order.LIVING && o.squad === this.num);
  }

  /** Online battles count only our own squad as ours to command. */
  private mine(ob: Walker, c: Walker): boolean {
    return this.world.multiplayer ? ob.squad === this.num : ob.teamNum === c.teamNum;
  }

  private take(ob: Walker): void {
    this.control = ob;
    ob.user = this.num;
    ob.setActType(Act.CONTROL);
    ob.stats.clearCommand();
  }

  /** Hands our unit back to the AI and takes the next squad member in the list. */
  private switchUnit(): void {
    const current = this.control!;
    if (current.user === this.num) {
      current.restoreActType();
      if (current.actType === Act.CONTROL) current.setActType(Act.RANDOM);
      current.user = -1;
    }
    const list = this.world.oblist;
    const start = list.indexOf(current);
    for (let i = 1; i <= list.length; i++) {
      const ob = list[(start + i) % list.length];
      if (!ob.dead && ob.order === Order.LIVING && ob.teamNum === this.team && ob.realTeamNum === 255 && ob.user === -1 && (!this.world.multiplayer || ob.squad === this.num)) {
        this.take(ob);
        return;
      }
    }
    this.take(current);
  }

  private cycleSpecial(c: Walker): void {
    c.currentSpecial++;
    if (
      c.currentSpecial > NUM_SPECIALS - 1 ||
      specialName(c.family, c.currentSpecial) === 'NONE' ||
      (c.currentSpecial - 1) * 3 + 1 > c.stats.level
    ) {
      c.currentSpecial = 1;
    }
  }

  /** Squad mates without a leader come to us. */
  private yell(c: Walker): void {
    for (const ob of this.world.oblist) {
      if (ob.order === Order.LIVING && ob.actType !== Act.CONTROL && this.mine(ob, c) && !ob.leader) {
        ob.leader = c;
        ob.foe = null;
        ob.stats.forceCommand(Command.FOLLOW, 100, 0, 0);
      }
    }
    c.yoDelay = 50;
    this.world.sound('yo', c);
    this.world.notify('Yo!', c);
  }

  /** Toggle whether the squad sticks with us (ACTION_FOLLOW) or roams freely. */
  private toggleDefend(c: Walker): void {
    const world = this.world;
    if (c.action === Action.NONE) {
      for (const ob of world.oblist) {
        if (!this.mine(ob, c)) continue;
        ob.leader = c;
        ob.foe = null;
        ob.action = Action.FOLLOW;
      }
      world.notify('SUMMONING DEFENSE!', c);
    } else if (c.action === Action.FOLLOW) {
      for (const ob of world.oblist) {
        if (ob.order === Order.LIVING && ob.actType !== Act.CONTROL && this.mine(ob, c)) ob.action = Action.NONE;
      }
      c.action = Action.NONE;
      world.notify('RELEASING MEN!', c);
    } else {
      c.action = Action.NONE;
    }
  }
}
