// Projectiles and placed objects such as trees and doors (weap.cpp).

import { FxFamily, Order, WeaponFamily as W } from '../data/objects.ts';
import { aniFrame } from './animations.ts';
import { Act, Ani, Face, Genre, GRID_SIZE, NUM_FACINGS } from './constants.ts';
import { idiv } from './math.ts';
import { Walker } from './walker.ts';

export class Weapon extends Walker {
  /** Elf rocks bounce off walls instead of breaking. */
  doBounce = false;

  override act(): number {
    if (this.foe?.dead) this.foe = null;
    if (this.leader?.dead) this.leader = null;
    if (this.owner?.dead) this.owner = null;
    if (!this.owner) this.owner = this; // our thrower died
    this.collideOb = null;
    if (this.aniType !== Ani.WALK) return this.animate();

    // Meant to shorten range in forests, but the original passes pixel coordinates where tile
    // coordinates are expected, so it only ever triggers in the map's top-left corner.
    if (this.world.genreAt(this.xpos, this.ypos) === Genre.TREES && this.lineofsight) this.lineofsight--;

    switch (this.actType) {
      case Act.FIRE:
        this.actFire();
        return 1;
      case Act.DIE:
        this.dead = true;
        return 1;
      default:
        return 1; // sitting trees, doors, blood
    }
  }

  override death(): number {
    if (this.deathCalled) return 0;
    this.deathCalled = true;
    const world = this.world;

    switch (this.family) {
      case W.KNIFE: {
        // Soldiers' knives fly back to them.
        if (this.owner && this.owner.family !== 0) break;
        const back = world.addOb(Order.FX, FxFamily.KNIFE_BACK);
        back.owner = this.owner;
        back.centerOn(this);
        back.lastx = this.lastx;
        back.lasty = this.lasty;
        back.stepsize = this.stepsize;
        back.aniType = Ani.ATTACK;
        back.damage = this.damage;
        break;
      }
      case W.ROCK:
        if (!this.doBounce || !this.lineofsight || this.collideOb) break;
        this.bounce();
        break;
      case W.FIRE_ARROW:
      case W.BOULDER: {
        if (!this.skipExit) break; // skipExit marks the exploding kind
        if (!this.owner || this.owner.dead) this.owner = this;
        const boom = world.addOb(Order.FX, FxFamily.EXPLOSION);
        world.sound('explode', this);
        boom.owner = this.owner;
        boom.stats.hitpoints = 0;
        boom.stats.level = this.owner.stats.level;
        boom.aniType = Ani.EXPLODE;
        boom.centerOn(this);
        boom.damage = this.damage * 2;
        break;
      }
      case W.WAVE:
        this.dead = false;
        this.transformTo(Order.WEAPON, W.WAVE2);
        this.stats.hitpoints = this.stats.maxHitpoints;
        break;
      case W.WAVE2:
        this.dead = false;
        this.transformTo(Order.WEAPON, W.WAVE3);
        this.stats.hitpoints = this.stats.maxHitpoints;
        break;
      case W.DOOR: {
        const open = world.addWeapOb(Order.FX, FxFamily.DOOR_OPEN);
        open.aniType = Ani.DOOR_OPEN;
        open.setxy(this.xpos, this.ypos);
        open.stats.level = this.stats.level;
        open.teamNum = this.teamNum;
        if (world.genreAt(idiv(this.xpos, GRID_SIZE), idiv(this.ypos, GRID_SIZE) - 1) === Genre.WALL) open.curdir = Face.RIGHT;
        else this.curdir = Face.UP;
        break;
      }
      default:
        break;
    }
    return 1;
  }

  /** Reflect off whichever wall we hit, if any direction is open. */
  private bounce(): void {
    const world = this.world;
    const { lastx, lasty } = this;
    this.dead = false;
    if (world.queryGridPassable(this.xpos + lastx, this.ypos + lasty, this)) {
      this.dead = true; // not a wall: break normally
      return;
    }
    const tries: [number, number][] = [
      [-1, 1],
      [1, -1],
      [-1, -1],
    ];
    for (const [fx, fy] of tries) {
      if (world.queryGridPassable(this.xpos + fx * lastx, this.ypos + fy * lasty, this)) {
        this.setxy(this.xpos + fx * lastx, this.ypos + fy * lasty);
        this.lastx = fx * lastx;
        this.lasty = fy * lasty;
        this.deathCalled = false;
        return;
      }
    }
    this.dead = true;
  }

  override animate(): number {
    switch (this.family) {
      case W.TREE:
      case W.BLOOD: {
        if (this.aniType > 1) this.aniType = 0;
        const index = this.curdir + this.aniType * NUM_FACINGS;
        this.setFrame(aniFrame(this.ani, index, this.cycle));
        this.cycle++;
        if (aniFrame(this.ani, index, this.cycle) === -1) {
          this.aniType = 0;
          this.cycle = 0;
        }
        break;
      }
      case W.CIRCLE_PROTECTION:
        if (!this.owner || this.owner.dead || this.stats.hitpoints < 1) {
          this.dead = true;
          return this.death();
        }
        this.centerOn(this.owner);
        break;
      case W.GLOW: {
        if (this.aniType > 2) this.aniType = 2;
        const index = this.curdir + this.aniType * NUM_FACINGS;
        this.setFrame(aniFrame(this.ani, index, this.cycle));
        this.cycle++;
        if (aniFrame(this.ani, index, this.cycle) === -1) {
          this.aniType = 2; // keep pulsing
          this.cycle = 0;
        }
        if (this.lifetime-- < 1) {
          this.dead = true;
          this.death();
        }
        break;
      }
      default:
        this.aniType = 0;
        this.setFrame(aniFrame(this.ani, this.curdir, this.cycle));
        this.cycle++;
        if (aniFrame(this.ani, this.curdir, this.cycle) === -1) this.cycle = 0;
        break;
    }
    return 1;
  }
}
