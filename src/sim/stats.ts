// Per-object statistics, the command queue that drives AI behaviour, and the AI's movement
// routines: direct walking, right-hand-rule wall following and reacting to hits (stats.cpp).

import { LivingFamily as L, Order } from '../data/objects.ts';
import { Act, CHECK_STEP_SIZE, Command, NUM_SPECIALS } from './constants.ts';
import { sign } from './math.ts';
import type { Walker } from './walker.ts';

export interface QueuedCommand {
  type: number;
  count: number;
  com1: number;
  com2: number;
}

/** Unit vector for each facing. */
const FACE_DELTAS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

export function faceDelta(dir: number): readonly [number, number] {
  return FACE_DELTAS[dir] ?? [0, 0];
}

export class Statistics {
  readonly controller: Walker;
  hitpoints = 10;
  maxHitpoints = 10;
  magicpoints = 50;
  maxMagicpoints = 50;
  level = 1;
  armor = 0;
  maxHealDelay = 1000;
  currentHealDelay = 1000;
  maxMagicDelay = 1000;
  currentMagicDelay = 1000;
  magicPerRound = 0;
  healPerRound = 0;
  bitFlags = 0;
  frozenDelay = 0;
  specialCost: number[] = new Array(NUM_SPECIALS).fill(0);
  weaponCost = 0;
  deleteMe = false;
  lastDistance = 15000;
  currentDistance = 15000;
  walkrounds = 0;
  /** Head is the next command to run. */
  commands: QueuedCommand[] = [];
  oldOrder: number;
  oldFamily: number;
  name = '';

  constructor(controller: Walker) {
    this.controller = controller;
    this.oldOrder = controller.order;
    this.oldFamily = controller.family;
  }

  hasFlag(flag: number): boolean {
    return (this.bitFlags & flag) !== 0;
  }

  setFlag(flag: number, on: boolean): void {
    this.bitFlags = on ? this.bitFlags | flag : this.bitFlags & ~flag;
  }

  // --- Command queue ------------------------------------------------------

  clearCommand(): void {
    const c = this.controller;
    this.commands = [];
    c.currentWeapon = c.defaultWeapon;
    if (c.realTeamNum !== 255) {
      c.teamNum = c.realTeamNum;
      c.realTeamNum = 255;
    }
    c.leader = null;
  }

  /** Queues a command at the back. */
  addCommand(type: number, count: number, com1 = 0, com2 = 0): void {
    if (type === Command.DIE) {
      this.deleteMe = true;
      return;
    }
    this.commands.push(makeCommand(type, count, com1, com2));
  }

  /** Puts a command at the front, ahead of everything queued. */
  forceCommand(type: number, count: number, com1 = 0, com2 = 0): void {
    this.commands.unshift(makeCommand(type, count, com1, com2));
  }

  tryCommand(type: number, count: number, com1?: number, com2?: number): number {
    const rng = this.controller.world.rng;
    if (type === Command.RANDOM_WALK && com1 === undefined) {
      this.addCommand(Command.WALK, count, rng.random(3) - 1, rng.random(3) - 1);
    } else {
      this.addCommand(type, count, com1 ?? 0, com2 ?? 0);
    }
    return 0;
  }

  setCommand(type: number, count: number, com1?: number, com2?: number): void {
    const rng = this.controller.world.rng;
    if (type === Command.RANDOM_WALK && com1 === undefined) {
      this.forceCommand(Command.WALK, count, rng.random(3) - 1, rng.random(3) - 1);
    } else {
      this.forceCommand(type, count, com1 ?? 0, com2 ?? 0);
    }
  }

  /** Runs one step of the front command. Returns nonzero if a command consumed this turn. */
  doCommand(): number {
    const c = this.controller;
    const world = c.world;
    const head = this.commands[0];
    if (!head) return 0;

    const { type, com1, com2 } = head;
    const count = head.count--;
    if (count < 2) this.commands.shift();

    switch (type) {
      case Command.WALK:
        c.walkstep(com1, com2);
        break;
      case Command.FIRE:
        if (c.order !== Order.LIVING) break;
        if (!c.fireCheck(com1, com2)) return 0;
        c.initFire(com1, com2);
        break;
      case Command.DIE:
        if (count < 2) this.deleteMe = true;
        break;
      case Command.FOLLOW: {
        if (c.foe) {
          c.leader = null;
          return 0;
        }
        if (!c.leader) {
          c.leader = world.followLeaderFor(c);
          if (!c.leader) return 0;
        }
        if (c.distanceTo(c.leader) < 60) {
          c.leader = null; // don't crowd the leader
          return 1;
        }
        let nx = c.leader.xpos - c.xpos;
        let ny = c.leader.ypos - c.ypos;
        if (Math.abs(nx) > Math.abs(3 * ny)) ny = 0;
        if (Math.abs(ny) > Math.abs(3 * nx)) nx = 0;
        c.walkstep(sign(nx), sign(ny));
        if (count < 2) c.leader = null;
        break;
      }
      case Command.QUICK_FIRE:
        c.walkstep(com1, com2);
        c.fire();
        break;
      case Command.MULTIDO:
        for (let i = 0; i < com1; i++) this.doCommand();
        break;
      case Command.RUSH:
        if (c.order === Order.LIVING) {
          c.walkstep(com1, com2);
          c.walkstep(com1, com2);
          c.walkstep(com1, com2);
          const target = c.collideOb;
          if (target) {
            c.attack(target);
            target.stats.clearCommand();
            target.stats.forceCommand(Command.WALK, 4, com1, com2);
          }
        }
        break;
      case Command.SET_WEAPON:
        c.currentWeapon = com1;
        break;
      case Command.RESET_WEAPON:
        c.currentWeapon = c.defaultWeapon;
        break;
      case Command.SEARCH:
        if (c.foe && !c.foe.dead) this.walkToFoe();
        break;
      case Command.RIGHT_WALK:
        if (c.foe) {
          const distance = c.distanceTo(c.foe);
          if (distance > 120 && distance < 240) this.rightWalk();
          else if (!this.directWalk()) this.rightWalk();
        }
        break;
      case Command.ATTACK: {
        if (!c.foe || c.foe.dead) return 1;
        let dx = c.foe.xpos - c.xpos;
        let dy = c.foe.ypos - c.ypos;
        if (Math.abs(dx) > Math.abs(3 * dy)) dy = 0;
        if (Math.abs(dy) > Math.abs(3 * dx)) dx = 0;
        dx = sign(dx);
        dy = sign(dy);
        if (!c.fireCheck(dx, dy)) {
          c.walkstep(dx, dy);
        } else {
          this.forceCommand(Command.FIRE, world.rng.random(5), dx, dy);
          c.initFire(dx, dy);
        }
        break;
      }
      default:
        break;
    }
    return 1;
  }

  // --- Reactions -----------------------------------------------------------

  /** Called whenever we take damage from `who` (a walker or its weapon). */
  hitResponse(who: Walker): void {
    const c = this.controller;
    const world = c.world;
    if (who.dead || c.dead) return;
    if (c.actType === Act.CONTROL) return;
    if (c.order !== Order.LIVING) return;

    const foe = who.order === Order.WEAPON && who.owner ? who.owner : who;
    const possible = new Array<boolean>(NUM_SPECIALS).fill(false);
    for (let i = 0; i <= Math.trunc((this.level + 2) / 3); i++) {
      if (i < NUM_SPECIALS && this.magicpoints >= this.specialCost[i]) possible[i] = true;
    }

    switch (c.family) {
      case L.MAGE: {
        const threshold = c.myguy ? Math.trunc((3 * this.maxHitpoints) / 5) : Math.trunc((3 * this.maxHitpoints) / 8);
        if (this.hitpoints < threshold && possible[1]) {
          c.currentSpecial = 1; // teleport to safety
          c.shifterDown = 0;
          c.busy = 0;
          c.special();
        } else if (c.foe !== foe) {
          c.foe = foe;
          foe.foe = c;
          this.lastDistance = this.currentDistance = 15000;
        }
        break;
      }
      case L.ARCHMAGE: {
        c.busy = 0;
        const threshold = c.myguy ? Math.trunc((3 * this.maxHitpoints) / 5) : Math.trunc((3 * this.maxHitpoints) / 8);
        if (this.hitpoints < threshold && possible[1] && world.rng.random(3)) {
          c.currentSpecial = 1;
          c.shifterDown = 0;
          c.busy = 0;
          c.special();
          break;
        }
        if (c.foe !== foe) {
          c.foe = foe;
          foe.foe = c;
          this.lastDistance = this.currentDistance = 15000;
        }
        if (!world.findFoesInRange(200, c).length) break;
        if (possible[3]) {
          c.currentSpecial = 3;
          if (c.special()) return;
        }
        if (possible[2]) {
          const teleportAway = () => {
            if (this.magicpoints >= this.specialCost[1]) {
              c.busy = 0;
              c.special();
            }
          };
          if (world.rng.random(2)) {
            c.shifterDown = 1; // chain lightning
            c.currentSpecial = 2;
            if (c.special()) {
              c.shifterDown = 0;
              teleportAway();
              return;
            }
          }
          c.shifterDown = 0;
          c.currentSpecial = 2;
          if (c.special()) {
            teleportAway();
            return;
          }
        }
        break;
      }
      case L.ARCHER: {
        // Keep at range.
        if (!c.foe || c.foe !== foe) {
          c.foe = foe;
          this.clearCommand();
          this.lastDistance = this.currentDistance = 15000;
        }
        if (c.distanceTo(foe) < 64) {
          this.forceCommand(Command.WALK, 8, sign(c.xpos - foe.xpos), sign(c.ypos - foe.ypos));
        }
        break;
      }
      default: {
        if (c.checkSpecial() && !world.rng.random(3)) c.special();
        const threshold = c.myguy ? Math.trunc((5 * this.maxHitpoints) / 10) : Math.trunc((5 * this.maxHitpoints) / 16);
        if (this.hitpoints < threshold && !c.yoDelay) this.yellForHelp(foe);
        if (c.foe !== foe) {
          this.clearCommand();
          c.foe = foe;
          foe.foe = c;
          this.lastDistance = this.currentDistance = 32000;
        }
        break;
      }
    }
  }

  /** Badly hurt: rally nearby friends against `foe` and retreat. */
  yellForHelp(foe: Walker): void {
    const c = this.controller;
    c.yoDelay += 80;
    for (const friend of c.world.findFriendsInRange(160, c)) {
      friend.leader = c;
      if (foe !== friend.foe) friend.stats.lastDistance = friend.stats.currentDistance = 32000;
      friend.foe = foe;
    }
    this.forceCommand(Command.WALK, 16, sign(c.xpos - foe.xpos), sign(c.ypos - foe.ypos));
    if (c.myguy && c.teamNum === 0) c.world.notify(`${c.myguy.name} yells for help!`, c);
  }

  // --- Pathing ---------------------------------------------------------------

  private blockedAt(dx: number, dy: number): boolean {
    const c = this.controller;
    return !c.world.queryPassable(c.xpos + dx, c.ypos + dy, c);
  }

  /** Is the square to our right (relative to facing) blocked? */
  rightBlocked(): boolean {
    const [fx, fy] = faceDelta((this.controller.curdir + 2) & 7);
    return this.blockedAt(fx * CHECK_STEP_SIZE, fy * CHECK_STEP_SIZE);
  }

  rightForwardBlocked(): boolean {
    const [fx, fy] = faceDelta((this.controller.curdir + 1) & 7);
    return this.blockedAt(fx * CHECK_STEP_SIZE, fy * CHECK_STEP_SIZE);
  }

  rightBackBlocked(): boolean {
    const [fx, fy] = faceDelta((this.controller.curdir + 3) & 7);
    return this.blockedAt(fx * CHECK_STEP_SIZE, fy * CHECK_STEP_SIZE);
  }

  forwardBlocked(): boolean {
    const [fx, fy] = faceDelta(this.controller.curdir);
    return this.blockedAt(fx * CHECK_STEP_SIZE, fy * CHECK_STEP_SIZE);
  }

  /** Follow walls using the right-hand rule. */
  rightWalk(): number {
    const c = this.controller;
    if (this.rightBlocked() || this.rightForwardBlocked()) {
      if (!this.forwardBlocked()) {
        let dx = c.lastx;
        let dy = c.lasty;
        if (Math.abs(dx) > Math.abs(3 * dy)) dy = 0;
        if (Math.abs(dy) > Math.abs(3 * dx)) dx = 0;
        return c.walkstep(sign(dx), sign(dy));
      }
      c.enddir = (c.enddir + 6) % 8; // turn left
      return c.turn(c.enddir);
    }
    if (this.forwardBlocked()) {
      c.enddir = (c.enddir + 6) % 8;
      return c.turn(c.enddir);
    }
    if (this.rightBackBlocked()) {
      c.enddir = (c.enddir + 2) % 8; // turn right, then step that way
      const [dx, dy] = faceDelta(c.enddir);
      this.addCommand(Command.WALK, 1, dx, dy);
      return 1;
    }
    if (!this.directWalk()) {
      const [dx, dy] = faceDelta(c.curdir);
      return c.walkstep(dx, dy);
    }
    return 1;
  }

  /** Step straight toward our foe if terrain allows, or attack if we can already hit it. */
  directWalk(): number {
    const c = this.controller;
    const foe = c.foe;
    if (!foe) return 0;
    let dx = foe.xpos - c.xpos;
    let dy = foe.ypos - c.ypos;
    if (Math.abs(dx) > Math.abs(3 * dy)) dy = 0;
    if (Math.abs(dy) > Math.abs(3 * dx)) dx = 0;

    if (c.fireCheck(dx, dy)) {
      this.clearCommand();
      c.turn(c.facing(dx, dy));
      this.addCommand(Command.ATTACK, 30 + c.world.rng.random(25), 0, 0);
      return 1;
    }
    dx = sign(dx);
    dy = sign(dy);
    const sx = dx * c.stepsize;
    const sy = dy * c.stepsize;
    const world = c.world;
    if (world.queryGridPassable(c.xpos + sx, c.ypos + sy, c)) {
      if (!dx && !dy) return this.stopWalking();
      c.walkstep(dx, dy);
      return 1;
    }
    if (world.queryGridPassable(c.xpos + sx, c.ypos, c)) {
      if (!dx) return this.stopWalking();
      c.walkstep(dx, 0);
      return 1;
    }
    if (world.queryGridPassable(c.xpos, c.ypos + sy, c)) {
      if (!dy) return this.stopWalking();
      c.walkstep(0, dy);
      return 1;
    }
    return this.stopWalking();
  }

  private stopWalking(): number {
    this.walkrounds = 0;
    return 0;
  }

  /** COMMAND_SEARCH: close in on our foe, switching to attack when enemies are near. */
  walkToFoe(): number {
    const c = this.controller;
    const world = c.world;
    const foe = c.foe;
    if (!foe || !world.rng.random(300)) {
      this.lastDistance = this.currentDistance = 15000;
      return 0;
    }

    // The original's check counter is a function static shared by every walker.
    let tempdistance = 9999999;
    world.searchCounter = (world.searchCounter + 1) & 0xffff;
    if (!(world.searchCounter % 3)) {
      const dx = foe.xpos - c.xpos;
      const dy = foe.ypos - c.ypos;
      tempdistance = c.distanceTo(foe);
      if (tempdistance < 200 || tempdistance < this.lastDistance) {
        const foes = world.findFoesInRange(200, c);
        if (foes.length > 0) {
          this.clearCommand();
          c.turn(c.facing(dx, dy));
          this.tryCommand(Command.ATTACK, 30 + world.rng.random(25), 1, 1);
          world.findNearFoe(c);
          if (!c.foe) {
            c.foe = foes[0];
            this.lastDistance = c.distanceTo(foe);
          }
          c.initFire();
          return 1;
        }
        // Our foe has moved; let this search lapse.
        if (this.commands[0]) this.commands[0].count = 0;
      }
    }

    if (tempdistance < this.lastDistance) {
      this.lastDistance = tempdistance;
      if (!this.directWalk()) this.rightWalk();
    } else {
      this.rightWalk();
    }
    if (tempdistance < 30 && this.commands[0]) this.commands[0].count = 0;
    return 1;
  }
}

function makeCommand(type: number, count: number, com1: number, com2: number): QueuedCommand {
  if (type === Command.WALK) {
    com1 = Math.max(-1, Math.min(1, com1));
    com2 = Math.max(-1, Math.min(1, com2));
    if (!com1 && !com2) com1 = com2 = 1;
  }
  return { type, count, com1, com2 };
}

