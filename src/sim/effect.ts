// Short-lived visual and area effects (effect.cpp): explosions, returning knives, shields,
// boomerangs, poison clouds, chain lightning and opening doors.

import { FxFamily as F, Order, WeaponFamily as W } from '../data/objects.ts';
import { aniFrame } from './animations.ts';
import { Ani, Bit, Command, NUM_FACINGS } from './constants.ts';
import { idiv, sign } from './math.ts';
import { hits } from './obmap.ts';
import { Walker } from './walker.ts';

/** Offsets for things orbiting their owner, 16 steps round a 24px circle. */
const ORBIT: readonly (readonly [number, number])[] = [
  [0, -24], [-9, -22], [-17, -17], [-22, -9], [-24, 0], [-22, 9], [-17, 17], [-9, 22],
  [0, 24], [9, 22], [17, 17], [22, 9], [24, 0], [22, -9], [17, -17], [9, -22],
];

export class Effect extends Walker {
  override act(): number {
    if (this.foe?.dead) this.foe = null;
    if (this.leader?.dead) this.leader = null;
    if (this.owner?.dead) this.owner = null;
    this.collideOb = null;

    switch (this.family) {
      case F.GHOST_SCARE:
        if (this.owner) this.centerOn(this.owner);
        break;
      case F.MAGIC_SHIELD:
        if (!this.owner) return this.vanish();
        this.orbit(ORBIT[this.drawcycle % 16], this.sizex, this.sizex);
        break;
      case F.BOOMERANG: {
        if (!this.owner || this.drawcycle > 253) return this.vanish();
        // Spirals outward as it ages.
        const [ox, oy] = ORBIT[this.drawcycle % 16];
        const grow = this.drawcycle + 4;
        this.orbit([idiv(ox * grow, 48), idiv(oy * grow, 48)], this.sizex * 2, this.sizex);
        break;
      }
      case F.KNIFE_BACK:
        this.actKnifeBack();
        break;
      case F.CLOUD:
        this.actCloud();
        break;
      case F.CHAIN:
        return this.actChain();
      case F.DOOR_OPEN: {
        if (this.aniType !== Ani.WALK) return this.animate();
        // Leave a permanent open door behind.
        const open = this.world.addFxOb(Order.FX, F.DOOR_OPEN);
        open.aniType = Ani.WALK;
        open.setxy(this.xpos, this.ypos);
        open.stats.level = this.stats.level;
        open.teamNum = this.teamNum;
        open.ignore = true;
        open.curdir = this.curdir;
        open.animate();
        this.vanish();
        return 1;
      }
      default:
        break;
    }
    if (this.aniType !== Ani.WALK) return this.animate();
    this.vanish();
    return 0;
  }

  private vanish(): number {
    this.dead = true;
    this.death();
    return 1;
  }

  /** Circle the owner, destroying enemy missiles and striking enemies we touch. */
  private orbit([dx, dy]: readonly [number, number], weaponRange: number, foeRange: number): void {
    const world = this.world;
    this.centerOn(this.owner!);
    this.setxy(this.xpos + dx, this.ypos + dy);
    for (const missile of world.findFoeWeaponsInRange(weaponRange, this)) {
      this.stats.hitpoints -= missile.damage;
      missile.dead = true;
      missile.death();
    }
    for (const enemy of world.findFoesInRange(foeRange, this)) {
      this.stats.hitpoints -= enemy.damage;
      this.attack(enemy);
      this.dead = false;
    }
    if (this.stats.hitpoints <= 0 || this.lifetime-- < 0) this.vanish();
  }

  private actKnifeBack(): void {
    const owner = this.owner;
    if (!owner) {
      this.dead = true;
      return;
    }
    if (this.distanceTo(owner) <= 10) {
      owner.weaponsLeft++; // caught
      this.aniType = Ani.WALK;
      this.dead = true;
      return;
    }
    const step = (target: number, pos: number) => {
      const d = target - pos;
      return Math.abs(d) > this.stepsize ? sign(d) * this.stepsize : d;
    };
    const xd = step(owner.xpos, this.xpos);
    const yd = step(owner.ypos, this.ypos);
    this.setxy(this.xpos + xd, this.ypos + yd);
    // Hits anything on the way back via a throwaway knife.
    const probe = this.world.addOb(Order.WEAPON, W.KNIFE);
    probe.damage = this.damage;
    probe.owner = owner;
    probe.teamNum = this.teamNum;
    probe.deathCalled = true; // don't spawn another returning knife
    probe.setxy(this.xpos, this.ypos);
    if (!this.world.queryObjectPassable(this.xpos + xd, this.ypos + yd, probe) && probe.collideOb) {
      probe.attack(probe.collideOb);
      this.damage = idiv(this.damage, 4);
    }
    probe.dead = true;
  }

  private actCloud(): void {
    const world = this.world;
    if (this.lifetime > 0) this.lifetime--;
    else this.vanish();
    if (this.lifetime < 8) this.invisibilityLeft += 3;
    if (this.invisibilityLeft > 0) this.invisibilityLeft--;
    for (const foe of world.findFoesInRange(this.sizex, this)) {
      if (hits(this.xpos, this.ypos, this.sizex, this.sizey, foe.xpos, foe.ypos, foe.sizex, foe.sizey)) this.attack(foe);
    }
    if (this.stats.commands.length) {
      this.stats.doCommand();
    } else {
      let xd = 0;
      let yd = 0;
      while (!xd && !yd) {
        xd = world.rng.random(3) - 1;
        yd = world.rng.random(3) - 1;
      }
      this.stats.addCommand(Command.WALK, world.rng.random(20), xd, yd);
    }
  }

  private actChain(): number {
    const world = this.world;
    const leader = this.leader;
    const owner = this.owner;
    if (!leader || this.lineofsight < 1 || !owner) return this.vanish();

    if (hits(this.xpos, this.ypos, this.sizex, this.sizey, leader.xpos, leader.ypos, leader.sizex, leader.sizey)) {
      const boom = world.addOb(Order.FX, F.EXPLOSION);
      boom.owner = owner;
      boom.teamNum = this.teamNum;
      boom.stats.level = this.stats.level;
      boom.damage = this.damage;
      boom.aniType = Ani.EXPLODE;
      boom.centerOn(this);
      leader.skipExit += 3; // can't be chained again for 3 rounds
      world.sound('explode', this);

      // Arc on to further foes while the bolt still has power.
      const power = idiv(this.damage, 2);
      const range = owner.myguy ? 240 + idiv(owner.myguy.intelligence, 2) : 240 + this.stats.level * 5;
      const foes = world.findFoesInRange(range, this);
      if (foes.length && power > 20) {
        let remaining = world.rng.random(owner.stats.level) + 1;
        for (const foe of foes) {
          if (!remaining--) break;
          if (foe === leader || foe.skipExit >= 1) continue;
          const bolt = world.addOb(Order.FX, F.CHAIN);
          bolt.owner = owner;
          bolt.leader = foe;
          bolt.stats.level = this.stats.level;
          bolt.stats.setFlag(Bit.MAGICAL, true);
          bolt.damage = power;
          bolt.teamNum = this.teamNum;
          bolt.centerOn(this);
        }
      }
      return this.vanish();
    }

    this.lineofsight--;
    if (this.distanceToCenter(leader) <= this.stepsize * 2) {
      this.centerOn(leader);
      return 1;
    }
    const step = (target: number, pos: number) => {
      const d = target - pos;
      return Math.abs(d) > this.stepsize ? sign(d) * this.stepsize : d;
    };
    const xd = step(leader.xpos, this.xpos);
    const yd = step(leader.ypos, this.ypos);
    this.curdir = this.facing(xd, yd);
    this.setFrame(aniFrame(this.ani, this.curdir, 0));
    this.setxy(this.xpos + xd, this.ypos + yd);
    return 1;
  }

  override animate(): number {
    const index = this.curdir + this.aniType * NUM_FACINGS;
    this.setFrame(aniFrame(this.ani, index, this.cycle));
    this.cycle++;
    if (aniFrame(this.ani, index, this.cycle) === -1) {
      switch (this.family) {
        case F.MAGIC_SHIELD:
        case F.BOOMERANG:
        case F.KNIFE_BACK:
        case F.CLOUD:
        case F.MARKER:
          this.cycle = 0; // loop
          break;
        default:
          this.aniType = Ani.WALK; // done; act() removes us next tick
          break;
      }
    }
    return 1;
  }

  override death(): number {
    if (this.deathCalled) return 0;
    this.deathCalled = true;
    switch (this.family) {
      case F.GHOST_SCARE:
        this.scare();
        break;
      case F.BOMB:
        this.detonate();
        break;
      case F.EXPLOSION:
        this.blast();
        break;
      default:
        break;
    }
    return 1;
  }

  /** Ghost's scare: nearby enemies flee. */
  private scare(): void {
    const owner = this.owner;
    if (!owner || owner.dead) return;
    const rng = this.world.rng;
    for (const victim of this.world.findFoesInRange(50 + 10 * owner.stats.level, owner)) {
      if (victim.order !== Order.LIVING) continue;
      let duration = owner.stats.level * 25;
      if (victim.myguy) duration -= rng.random(victim.myguy.constitution);
      if (duration > 0) {
        victim.stats.forceCommand(Command.WALK, duration, sign(victim.xpos - this.xpos), sign(victim.ypos - this.ypos));
      }
    }
  }

  private detonate(): void {
    if (!this.owner || this.owner.dead) this.owner = this;
    this.world.sound('explode', this);
    const boom = this.world.addOb(Order.FX, F.EXPLOSION);
    boom.owner = this.owner;
    boom.stats.hitpoints = 0;
    boom.stats.level = this.owner.stats.level;
    boom.aniType = Ani.EXPLODE;
    boom.centerOn(this);
    boom.damage = this.damage;
  }

  /** Explosion damage and knockback, gentler on its owner and allies. */
  private blast(): void {
    const world = this.world;
    if (!this.owner || this.owner.dead) this.owner = this;
    const owner = this.owner;
    let radius = Math.min(4 * owner.stats.level, 96);
    if (this.skipExit) radius = 16; // magical blasts stay small
    world.damageTile(this.xpos + idiv(this.sizex, 2), this.ypos + idiv(this.sizey, 2));
    for (const target of world.findInRange(15 + radius, this)) {
      if (target.dead || target.order === Order.TREASURE || target.order === Order.FX) continue;
      if (this.skipExit && target === owner) continue;
      const push = Math.min(2 + idiv(owner.stats.level, 15), 8);
      target.stats.forceCommand(Command.WALK, push, sign(target.xpos - this.xpos), sign(target.ypos - this.ypos));
      const base = this.damage;
      if (target === owner) this.damage = idiv(base, 4);
      else if (!owner.dead && owner.isFriendly(target)) this.damage = idiv(base, 2);
      this.attack(target);
      this.damage = base;
    }
  }
}
