// Pick-ups and map features that react when walked over (treasure.cpp).

import { FxFamily, Order, TreasureFamily as T } from '../data/objects.ts';
import { Act, Ani, Bit } from './constants.ts';
import { keyBit } from './obmap.ts';
import { Walker } from './walker.ts';

export class Treasure extends Walker {
  override act(): number {
    return 1;
  }

  override eatMe(eater: Walker): number {
    const world = this.world;
    const rng = world.rng;
    const level = this.stats.level;
    const es = eater.stats;
    const tell = (message: string) => {
      if (eater.user !== -1) world.notify(message, eater);
    };

    switch (this.family) {
      case T.DRUMSTICK:
        if (es.hitpoints >= es.maxHitpoints) return 1;
        es.hitpoints = Math.min(es.maxHitpoints, es.hitpoints + 10 * level + rng.random(10 * level));
        this.dead = true;
        world.sound('eat', eater);
        return 1;
      case T.GOLD_BAR:
      case T.SILVER_BAR:
        if (eater.teamNum === 0 || eater.myguy) {
          world.addScore(eater.teamNum, (this.family === T.GOLD_BAR ? 200 : 50) * level, eater);
          this.dead = true;
          world.sound('money', eater);
        }
        return 1;
      case T.FLIGHT_POTION:
        if (!es.hasFlag(Bit.FLYING)) {
          eater.flightLeft += 150 * level;
          tell(`Potion of Flight(${level})!`);
          this.dead = true;
        }
        return 1;
      case T.MAGIC_POTION:
        es.magicpoints = Math.max(es.magicpoints, es.maxMagicpoints) + 50 * level;
        this.dead = true;
        tell(`Potion of Mana(${level})!`);
        return 1;
      case T.INVULNERABLE_POTION:
        if (!es.hasFlag(Bit.INVINCIBLE)) {
          eater.invulnerableLeft += 150 * level;
          this.dead = true;
          tell(`Potion of Invulnerability(${level})!`);
        }
        return 1;
      case T.INVIS_POTION:
        eater.invisibilityLeft += 150 * level;
        tell(`Potion of Invisibility(${level})!`);
        this.dead = true;
        return 1;
      case T.SPEED_POTION:
        eater.speedBonusLeft += 50 * level;
        eater.speedBonus = level;
        tell(`Potion of Speed(${level})!`);
        this.dead = true;
        return 1;
      case T.EXIT:
        // Only the player's controlled unit can take an exit, and only once enemies are gone
        // (or the scenario allows leaving early).
        if (eater.inAct) return 1;
        if (eater.actType !== Act.CONTROL || eater.skipExit > 1) return 1;
        eater.skipExit = 10;
        world.reachExit(level, eater);
        return 1;
      case T.TELEPORTER:
        return this.teleportEater(eater);
      case T.LIFE_GEM:
        if (eater.teamNum !== this.teamNum) return 1;
        world.addScore(eater.teamNum, this.stats.hitpoints, eater);
        this.flash();
        this.dead = true;
        this.death();
        return 1;
      case T.KEY:
        if (!(eater.keys & keyBit(level))) {
          eater.keys |= keyBit(level);
          if (eater.teamNum === 0) {
            world.notify(`${eater.myguy?.name ?? eater.stats.name} picks up key ${level}`, eater);
            world.sound('money', eater);
          }
        }
        return 1;
      default:
        return 1;
    }
  }

  private teleportEater(eater: Walker): number {
    if (eater.skipExit > 1) return 1;
    const distance = this.distanceToCenter(eater);
    if (distance > 21) return 1;
    if (distance < 4 && eater.skipExit) {
      eater.skipExit = 8;
      return 1;
    }
    eater.skipExit += 20;
    const target = this.leader ?? this.findTeleportTarget();
    if (!target) return 1;
    this.leader = target;
    eater.centerOn(target);
    if (!this.world.queryPassable(eater.xpos, eater.ypos, eater)) {
      eater.centerOn(this);
      return 1;
    }
    this.flash();
    this.world.sound('teleport', eater);
    return 1;
  }

  private flash(): void {
    const flash = this.world.addOb(Order.FX, FxFamily.FLASH);
    flash.aniType = Ani.EXPAND_8;
    flash.centerOn(this);
  }

  /** The next teleporter of the same level after us in the list, wrapping round. */
  private findTeleportTarget(): Walker | null {
    const list = this.world.fxlist;
    const me = list.indexOf(this);
    if (me === -1) return null;
    const matches = (ob: Walker) => !ob.dead && ob.isType(Order.TREASURE, T.TELEPORTER) && ob.stats.level === this.stats.level;
    return list.slice(me + 1).find(matches) ?? list.find(matches) ?? null;
  }
}
