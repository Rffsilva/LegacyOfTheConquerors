// Characters and monsters (living.cpp): regeneration, terrain effects, AI decisions,
// shoving friends and summoning.

import { LivingFamily as L, Order } from '../data/objects.ts';
import { Act, Action, Ani, Bit, Command, Genre, GRID_SIZE, MAXOBS, REGEN } from './constants.ts';
import { idiv } from './math.ts';
import { isAutoAttackable } from './obmap.ts';
import { specialName } from './specialNames.ts';
import { performSpecial } from './specials.ts';
import { Walker } from './walker.ts';

export class Living extends Walker {
  override currentSpecial = 1;

  override act(): number {
    const world = this.world;
    const rng = world.rng;
    const s = this.stats;

    if (this.bonusRounds > 0 && !this.dead) {
      this.bonusRounds--;
      this.act();
    }
    if (this.dead) return 0;
    if (this.foe && (this.foe.dead || rng.random(idiv(this.foe.invisibilityLeft, 20)) > 0)) this.foe = null;
    if (this.isFriendly(this.foe)) this.foe = null;
    if (this.leader?.dead) this.leader = null;
    if (this.owner?.dead) return this.die();

    if (this.lifetime) {
      // Summoned: vanish when our summoner goes or our time runs out.
      if (!this.owner || this.owner.dead) return this.die();
      if (this.lifetime-- < 1) {
        this.dead = true;
        return this.death();
      }
      if (this.family === L.FIREELEMENTAL && s.hitpoints < s.maxHitpoints) {
        // A hurt elemental heals by draining its summoner.
        const os = this.owner.stats;
        let paid = 0;
        if (os.hitpoints >= idiv(os.maxHitpoints, 3)) {
          paid = 1;
          os.hitpoints--;
        }
        if (paid && os.magicpoints >= 3) {
          paid++;
          os.magicpoints -= 3;
        }
        if (paid === 2) s.hitpoints++;
        else this.lifetime--;
      }
    }

    this.collideOb = null;
    const regenerating = !(world.enemyFreeze || this.bonusRounds);
    if (s.magicpoints < s.maxMagicpoints && regenerating) {
      s.magicpoints += s.magicPerRound;
      if (++s.currentMagicDelay >= s.maxMagicDelay) {
        s.magicpoints++;
        s.currentMagicDelay = 0;
      }
      s.magicpoints = Math.min(s.magicpoints, s.maxMagicpoints);
    }
    if (s.hitpoints < s.maxHitpoints && regenerating) {
      s.hitpoints += s.healPerRound;
      if (++s.currentHealDelay >= s.maxHealDelay) {
        s.hitpoints++;
        s.currentHealDelay = 0;
      }
      s.hitpoints = Math.min(s.hitpoints, s.maxHitpoints);
    }

    if (this.viewAll > 0) this.viewAll--;
    if (this.invulnerableLeft > 0) this.invulnerableLeft--;
    if (this.invisibilityLeft > 0) this.invisibilityLeft--;
    else this.outline = 0;
    if (this.flightLeft > 0) this.flightLeft--;

    // Standing somewhere we can't walk (water, after flight wears off) slowly drowns us.
    if (!world.queryGridPassable(this.xpos, this.ypos, this) && !this.flightLeft) {
      this.flightLeft++;
      s.hitpoints--;
      if (s.hitpoints < 1) {
        this.dead = true;
        this.death();
      }
    }

    if (this.charmLeft > 1) {
      this.charmLeft--;
    } else {
      this.charmLeft = 0;
      if (this.realTeamNum !== 255) {
        this.teamNum = this.realTeamNum;
        this.realTeamNum = 255;
      }
    }

    if (s.hasFlag(Bit.FORESTWALK) && this.inForest()) {
      if (s.magicpoints) s.magicpoints--;
      const slow = Math.max(0, this.myguy ? 4 - idiv(this.myguy.dexterity, 10) : 4 - idiv(s.level, 2));
      this.stepsize = Math.max(1, this.stepsize - slow);
    } else {
      this.stepsize = this.normalStepsize;
    }
    if (this.speedBonusLeft > 1) {
      this.speedBonusLeft--;
      this.stepsize += this.speedBonus;
    }

    if (this.family === L.ARCHMAGE) {
      // Archmages get glimpses of the whole map, more often as they level.
      const every = s.level >= 40 ? 1 : 40 - s.level;
      if (!(this.drawcycle % every)) this.viewAll++;
    }

    if (this.aniType !== Ani.WALK) return this.animate();
    if (s.frozenDelay) {
      s.frozenDelay--;
      return 1;
    }
    if (this.busy > 0) this.busy--;
    if (this.curdir !== this.enddir) return this.turn(this.enddir);
    if (s.commands.length && s.doCommand()) return 1;
    if (this.skipExit > 0) this.skipExit--;
    if (this.action && this.user === -1) {
      const result = this.doAction();
      if (result) return result;
    }

    switch (this.actType) {
      case Act.CONTROL:
      case Act.FIRE:
        return 1;
      case Act.GUARD:
        this.actGuard();
        return 0;
      case Act.DIE:
        this.dead = true;
        return 1;
      case Act.RANDOM:
        if (!rng.random(5)) {
          if (s.magicpoints >= s.specialCost[1]) {
            this.currentSpecial = rng.random(idiv(s.level + 2, 3)) + 1;
            if (this.currentSpecial > 4 || specialName(this.family, this.currentSpecial) === 'NONE') this.currentSpecial = 1;
            if (this.checkSpecial()) return this.special();
          } else {
            this.actRandom();
            return 1;
          }
        } else if (!rng.random(5)) {
          this.actRandom();
        } else {
          this.foe ??= world.findNearFoe(this);
          if (this.foe) {
            this.curdir = this.enddir = idiv(this.enddir, 2) * 2;
            s.tryCommand(Command.SEARCH, 300, 0, 0);
          } else if (!rng.random(2)) {
            this.foe = world.findFarFoe(this);
          } else {
            s.tryCommand(Command.RANDOM_WALK, 20);
          }
          return 1;
        }
        return 0;
      default:
        return 0;
    }
  }

  override special(): number {
    return performSpecial(this);
  }

  private die(): number {
    this.dead = true;
    this.death();
    return 0;
  }

  private inForest(): boolean {
    const world = this.world;
    const x0 = idiv(this.xpos, GRID_SIZE);
    const y0 = idiv(this.ypos, GRID_SIZE);
    const x1 = idiv(this.xpos + this.sizex, GRID_SIZE);
    const y1 = idiv(this.ypos + this.sizey, GRID_SIZE);
    return (
      world.genreAt(x0, y0) === Genre.TREES ||
      world.genreAt(x1, y0) === Genre.TREES ||
      world.genreAt(x1, y1) === Genre.TREES ||
      world.genreAt(x0, y1) === Genre.TREES
    );
  }

  /** Nudges a friend out of our way (and gets a cleric to heal). */
  override shove(target: Walker, x: number, y: number): number {
    if (target.dead || !this.isFriendly(target)) return 0;
    if (this.world.rng.random(3) && target.actType !== Act.CONTROL) {
      target.stats.clearCommand();
      if (target.family === L.CLERIC) {
        target.currentSpecial = 1; // heal
        target.special();
      }
      target.stats.setCommand(Command.WALK, 4, x, y);
      return 1;
    }
    return 0;
  }

  override walk(x: number, y: number): number {
    const dir = this.facing(x, y);
    if (this.curdir === dir) {
      if (!this.inWorld(this.xpos + x, this.ypos + y)) return 0;
      if (this.world.queryPassable(this.xpos + x, this.ypos + y, this)) {
        this.move(x, y);
        this.stepAnimation();
        return 1;
      }
      const blocker = this.collideOb;
      if (blocker && !blocker.dead && blocker.order === Order.LIVING && this.isFriendly(blocker)) {
        this.shove(blocker, x, y);
      }
      if (this.stats.hasFlag(Bit.ANIMATE)) this.stepAnimation();
      return 0;
    }
    // Livings turn gradually instead of snapping to the new facing.
    this.enddir = dir;
    if (this.actType !== Act.CONTROL || this.stats.commands.length) this.turn(this.enddir);
    return 1;
  }

  /** Bumping into an enemy (or something attackable) starts an attack. */
  override collide(ob: Walker): number {
    this.collideOb = ob;
    if (isAutoAttackable(ob) && !this.isFriendly(ob) && !ob.dead && !this.dead) this.initFire();
    return 1;
  }

  override doSummon(family: number, lifetime: number): Walker {
    const summoned = this.world.addOb(Order.LIVING, family);
    summoned.owner = this;
    summoned.lifetime = lifetime;
    summoned.transformTo(Order.LIVING, family);
    return summoned;
  }

  /** Is now a sensible moment for the AI to use its special ability? */
  override checkSpecial(): number {
    const world = this.world;
    const s = this.stats;
    this.shifterDown = world.rng.random(2);
    if (s.magicpoints < s.specialCost[this.currentSpecial]) this.currentSpecial = 1;

    const foeDistance = (): number | null => {
      this.foe ??= world.findNearFoe(this);
      return this.foe ? this.distanceTo(this.foe) : null;
    };

    switch (this.family) {
      case L.SOLDIER: {
        const d = foeDistance();
        return d !== null && d < 75 && d > 20 ? 1 : 0; // charge: 1-3 squares away
      }
      case L.FIREELEMENTAL:
      case L.ARCHER:
      case L.GHOST:
      case L.ORC: {
        const d = foeDistance();
        return d !== null && d < 130 ? 1 : 0;
      }
      case L.THIEF:
        if (this.currentSpecial === 1) {
          // Bomb: only when not already closing in, and enough enemies are around.
          if (this.foe) {
            const d = this.distanceTo(this.foe);
            return d < 130 && d > 35 ? 0 : 1;
          }
          return world.findFoesInRange(110, this).length < 3 ? 0 : 1;
        }
        if (this.currentSpecial === 3) {
          const range = this.shifterDown ? 16 + 4 * s.level : 80 + 4 * s.level; // charm : taunt
          return world.findFoesInRange(range, this).length < 1 ? 0 : 1;
        }
        return 1;
      case L.MAGE: {
        const n = world.findFoesInRange(110, this).length;
        return n < 1 || n > 3 ? 1 : 0; // teleport when alone or swamped
      }
      case L.SLIME:
        return world.numobs < MAXOBS ? 1 : 0;
      case L.CLERIC:
        if (this.currentSpecial === 1) {
          if (world.findFriendsInRange(60, this).length > 1) {
            this.shifterDown = 0; // heal
            return 1;
          }
          if (s.magicpoints >= idiv(s.maxMagicpoints, 2)) {
            this.shifterDown = 1; // mystic mace
            return 1;
          }
          return 0;
        }
        return 1;
      case L.SKELETON:
        return world.findFoesInRange(5 * GRID_SIZE, this).length < 1 ? 1 : 0; // tunnel away
      default:
        return 1;
    }
  }

  /** Level scaling for monsters (living::set_difficulty). */
  override setDifficulty(level: number): void {
    const dif = this.world.difficultyPercent;
    const s = this.stats;
    const lev2 = level * level;
    const scale = (hp: number, mp: number, dmg: number, armor: number) => {
      s.maxHitpoints += hp * lev2;
      s.maxMagicpoints += mp * lev2;
      this.damage += dmg * level;
      s.armor += armor;
    };
    switch (this.family) {
      case L.ARCHER:
        scale(11, 12, 4, lev2);
        break;
      case L.MAGE:
        scale(7, 14, 3, idiv(lev2, 2));
        break;
      case L.CLERIC:
      case L.DRUID:
        scale(9, 12, 4, idiv(lev2, 2));
        break;
      case L.SOLDIER:
        scale(13, 8, 5, 2 * lev2);
        this.weaponsLeft = idiv(level + 1, 2);
        break;
      case L.ORC:
        scale(14, 7, 6, 3 * lev2);
        break;
      case L.GOLEM:
        scale(18, 5, 7, 4 * lev2);
        break;
      default:
        scale(11, 11, 4, 2 * lev2);
        break;
    }
    if (this.teamNum !== 0) {
      s.maxHitpoints = idiv(s.maxHitpoints * dif, 100);
      s.maxMagicpoints = idiv(s.maxMagicpoints * dif, 100);
      this.damage = idiv(this.damage * dif, 100);
    }
    s.hitpoints = s.maxHitpoints;
    s.magicpoints = s.maxMagicpoints;
    [s.healPerRound, s.maxHealDelay] = regenRate(lev2 * 4, s.healPerRound);
    s.currentHealDelay = 0;
    [s.magicPerRound, s.maxMagicDelay] = regenRate(lev2 * 30, s.magicPerRound);
    s.currentMagicDelay = 0;
  }

  /** Living version: hunt the nearest foe, shooting when there's a clear line. */
  protected override actRandom(): number {
    const world = this.world;
    if (!world.rng.random(80) || !this.foe) this.foe = world.findNearFoe(this);
    if (!this.foe) return this.stats.tryCommand(Command.RANDOM_WALK, 40);
    const dx = this.foe.xpos - this.xpos;
    const dy = this.foe.ypos - this.ypos;
    if (Math.abs(dx) < this.lineofsight * GRID_SIZE && Math.abs(dy) < this.lineofsight * GRID_SIZE) {
      if (this.fireCheck(dx, dy)) {
        this.initFire(dx, dy);
        this.stats.setCommand(Command.FIRE, world.rng.random(24), dx, dy);
        return 1;
      }
      this.turn(this.facing(dx, dy));
    }
    this.stats.tryCommand(Command.SEARCH, 200, 0, 0);
    return 1;
  }

  /** Squad orders for AI-controlled team members. */
  private doAction(): number {
    if (this.action !== Action.FOLLOW || this.foe) return 0;
    this.leader = this.world.findNearestPlayer(this);
    if (!this.leader) return 0;
    if (this.leader.foe) {
      this.foe = this.leader.foe;
      return 0;
    }
    this.stats.forceCommand(Command.FOLLOW, 5, 0, 0);
    return 1;
  }
}

/**
 * Converts "regeneration points per REGEN ticks" into a whole amount per tick plus a delay for
 * the fractional part, exactly as the original's while/divide dance does.
 */
export function regenRate(points: number, perRound: number): [perRound: number, maxDelay: number] {
  let maxDelay = REGEN;
  let remaining = points;
  while (remaining > REGEN) {
    remaining -= REGEN;
    perRound++;
  }
  if (remaining > 1) maxDelay = idiv(maxDelay, remaining + 1);
  return [perRound, Math.max(maxDelay, 2)];
}

