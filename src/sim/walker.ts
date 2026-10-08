// The base game object (walker.cpp) and its type setup (loader.cpp set_walker). Livings,
// weapons, effects and treasure specialise it in their own files; generators and squad
// markers use it as-is.

import {
  FxFamily,
  GeneratorFamily,
  LivingFamily as L,
  Order,
  TreasureFamily,
  WeaponFamily as W,
} from '../data/objects.ts';
import { aniFrame, type AnimationSet } from './animations.ts';
import { Act, Ani, Bit, Command, Face, GRID_SIZE, NUM_FACINGS, ScenType } from './constants.ts';
import { Guy, calculateLevel } from './guy.ts';
import { idiv, int8 } from './math.ts';
import { faceDelta, Statistics } from './stats.ts';
import { typeInfo } from './tables.ts';
import type { World } from './world.ts';

const FAMILY_DEATH_MESSAGES: Readonly<Record<number, string>> = {
  [L.SOLDIER]: 'SOLDIER SLAIN',
  [L.ARCHER]: 'ARCHER DIED',
  [L.THIEF]: 'THIEF KILLED',
  [L.ELF]: 'ELF KILLED',
  [L.MAGE]: 'MAGE DIED',
  [L.SKELETON]: 'SKELETON CRUMBLED',
  [L.CLERIC]: 'CLERIC DIED',
  [L.FIREELEMENTAL]: 'FIRE ELEMENTAL EXTINGUISHED',
  [L.FAERIE]: 'FAERIE POPPED',
  [L.SMALL_SLIME]: 'SLIME DESTROYED',
  [L.MEDIUM_SLIME]: 'SLIME DESTROYED',
  [L.SLIME]: 'SLIME DESTROYED',
  [L.GHOST]: 'GHOST VANISHED',
  [L.DRUID]: 'DRUID VANQUISHED',
  [L.ORC]: 'ORC DIED',
};

export class Walker {
  readonly id: number;
  readonly world: World;
  order: number;
  family: number;
  stats: Statistics;
  myguy: Guy | null = null;

  // Position and sprite (pixie) state.
  xpos = -1;
  ypos = -1;
  sizex = 0;
  sizey = 0;
  frames = 1;
  frame = 0;

  curdir: number = Face.UP;
  enddir: number = Face.UP;
  lastx = 0;
  lasty = 0;
  actType: number = Act.RANDOM;
  oldActType: number = Act.RANDOM;
  ani: AnimationSet | null = null;
  aniType = 0;
  cycle = 0;

  teamNum = 0;
  /** Original team while charmed; 255 when not charmed. */
  realTeamNum = 255;
  busy = 0;
  foe: Walker | null = null;
  leader: Walker | null = null;
  owner: Walker | null = null;
  collideOb: Walker | null = null;
  dead = false;
  deathCalled = false;
  /** Not listed in the collision map (bloodstains, thrown knives...). */
  ignore = false;

  stepsize = 0;
  normalStepsize = 0;
  lineofsight = 0;
  damage = 0;
  fireFrequency = 0;
  defaultWeapon: number = W.KNIFE;
  currentWeapon: number = W.KNIFE;
  /** Index of the player controlling us, or -1 for the AI. */
  user = -1;

  keys = 0;
  viewAll = 0;
  shifterDown = 0;
  bonusRounds = 0;
  weaponsLeft = 1;
  yoDelay = 0;
  action = 0;
  flightLeft = 0;
  invulnerableLeft = 0;
  invisibilityLeft = 0;
  charmLeft = 0;
  speedBonus = 0;
  speedBonusLeft = 0;
  drawcycle = 0;
  currentSpecial = 0;
  lifetime = 0;
  skipExit = 0;
  outline = 0;
  inAct = false;

  constructor(world: World, order: number, family: number) {
    this.world = world;
    this.id = world.nextId();
    this.order = order;
    this.family = family;
    this.stats = new Statistics(this);
    this.loadSprite();
  }

  // --- Type setup ------------------------------------------------------------

  private loadSprite(): void {
    const info = this.world.spriteInfo(this.order, this.family);
    this.sizex = info?.width ?? 0;
    this.sizey = info?.height ?? 0;
    this.frames = info?.frames ?? 1;
  }

  /** loader::set_walker: base stats and per-family abilities. */
  applyType(order: number, family: number): void {
    this.order = order;
    this.family = family;
    const info = typeInfo(order, family);
    this.setActType(info.act);
    this.ani = info.ani;
    this.stepsize = info.stepsize;
    this.normalStepsize = info.stepsize;
    this.lineofsight = info.lineofsight;
    this.damage = info.damage;
    this.fireFrequency = int8(info.fireFrequency);
    const s = this.stats;
    s.specialCost.fill(5000);

    switch (order) {
      case Order.LIVING:
        this.applyLivingType(family);
        this.currentWeapon = this.defaultWeapon;
        return;
      case Order.WEAPON:
        this.applyWeaponType(family);
        // The original's switch falls through from weapons into treasures and generators.
        this.applyTreasureType(family);
        this.applyGeneratorType(family);
        return;
      case Order.TREASURE:
        this.applyTreasureType(family);
        this.applyGeneratorType(family);
        return;
      case Order.GENERATOR:
        this.applyGeneratorType(family);
        return;
      case Order.FX:
        this.aniType = 0;
        if (family === FxFamily.MAGIC_SHIELD) s.setFlag(Bit.PHANTOM, true);
        if (family === FxFamily.CLOUD) s.setFlag(Bit.NO_COLLIDE | Bit.FLYING, true);
        return;
      default:
        return;
    }
  }

  private applyLivingType(family: number): void {
    const s = this.stats;
    const costs = (...c: number[]) => c.forEach((v, i) => (s.specialCost[i + 1] = v));
    switch (family) {
      case L.SOLDIER:
        costs(25, 100, 120, 150); // charge, boomerang, whirlwind, disarm
        s.weaponCost = 2;
        this.defaultWeapon = W.KNIFE;
        break;
      case L.ELF:
        costs(20, 28, 36, 42);
        s.setFlag(Bit.FORESTWALK, true);
        this.defaultWeapon = W.ROCK;
        break;
      case L.ARCHER:
        costs(20, 60, 70); // fire arrows, 3 arrows, exploding bolt
        this.defaultWeapon = W.ARROW;
        break;
      case L.THIEF:
        costs(35, 125, 100, 150); // bomb, cloak, taunt, poison cloud
        this.defaultWeapon = W.KNIFE;
        break;
      case L.CLERIC:
        this.defaultWeapon = W.GLOW;
        s.weaponCost = 8;
        costs(2, 20, 50, 150); // heal, skeleton, ghost, raise dead
        break;
      case L.SKELETON:
        this.defaultWeapon = W.BONE;
        this.aniType = Ani.SKEL_GROW;
        s.weaponCost = 0;
        costs(10); // tunnel
        break;
      case L.FAERIE:
        s.setFlag(Bit.ANIMATE | Bit.FLYING, true);
        this.defaultWeapon = W.SPRINKLE;
        s.weaponCost = 2;
        break;
      case L.MAGE:
        costs(15, 60, 500, 70, 100); // teleport, glow, freeze time, wave, burst
        s.weaponCost = 5;
        this.defaultWeapon = W.FIREBALL;
        break;
      case L.ARCHMAGE:
        costs(10, 80, 500, 150); // teleport, heartburst, summon elemental, mind control
        s.weaponCost = 12;
        this.defaultWeapon = W.FIREBALL;
        break;
      case L.FIREELEMENTAL:
        s.setFlag(Bit.ANIMATE, true);
        costs(50);
        s.maxMagicpoints = 150;
        this.defaultWeapon = W.METEOR;
        break;
      case L.SLIME:
      case L.SMALL_SLIME:
      case L.MEDIUM_SLIME:
        // The original meant small slimes to lose their ranged attack, but its check compared
        // the order against the family and never matched.
        s.setFlag(Bit.ANIMATE, true);
        costs(30);
        s.maxMagicpoints = 50;
        this.defaultWeapon = W.BLOB;
        s.weaponCost = 0;
        break;
      case L.GHOST:
        s.setFlag(Bit.ANIMATE | Bit.FLYING | Bit.ETHEREAL | Bit.NO_RANGED, true);
        costs(30); // scare
        this.defaultWeapon = W.KNIFE;
        s.weaponCost = 0;
        break;
      case L.DRUID:
        this.defaultWeapon = W.LIGHTNING;
        s.weaponCost = 4;
        costs(15, 80, 150, 200); // tree, faerie, reveal, shield
        break;
      case L.ORC:
        costs(25, 20); // howl, eat corpse
        s.weaponCost = 2;
        this.defaultWeapon = W.ROCK;
        s.setFlag(Bit.NO_RANGED, true);
        break;
      case L.BIG_ORC:
        s.weaponCost = 2;
        this.defaultWeapon = W.KNIFE;
        break;
      case L.BARBARIAN:
        s.weaponCost = 2;
        this.defaultWeapon = W.HAMMER;
        costs(20, 30); // hurl boulder, exploding boulder
        break;
      case L.GOLEM:
      case L.GIANT_SKELETON:
        s.weaponCost = 2;
        this.defaultWeapon = W.BOULDER;
        break;
      case L.TOWER1:
        s.weaponCost = 2;
        this.defaultWeapon = W.FIREBALL;
        break;
      default:
        break;
    }
  }

  private applyWeaponType(family: number): void {
    const s = this.stats;
    switch (family) {
      case W.ROCK:
        s.setFlag(Bit.FORESTWALK, true);
        break;
      case W.FIREBALL:
      case W.METEOR:
        s.setFlag(Bit.MAGICAL, true);
        break;
      case W.SPRINKLE:
        s.setFlag(Bit.FLYING, true);
        break;
      case W.GLOW:
        this.lifetime = 350;
        break;
      case W.WAVE:
      case W.WAVE2:
      case W.WAVE3:
        s.setFlag(Bit.IMMORTAL | Bit.NO_COLLIDE | Bit.PHANTOM | Bit.FLYING | Bit.MAGICAL, true);
        break;
      case W.CIRCLE_PROTECTION:
        s.setFlag(Bit.IMMORTAL | Bit.NO_COLLIDE | Bit.PHANTOM | Bit.FLYING, true);
        this.aniType = 5;
        break;
      default:
        break;
    }
  }

  /** Treasure setup; also applied to weapons by the original's switch fall-through. */
  private applyTreasureType(family: number): void {
    switch (family) {
      case TreasureFamily.STAIN: // also W.KNIFE: thrown knives are left out of the collision map
        this.ignore = true;
        break;
      case TreasureFamily.GOLD_BAR:
      case TreasureFamily.MAGIC_POTION:
        this.setDirectFrame(0);
        break;
      case TreasureFamily.SILVER_BAR:
      case TreasureFamily.INVIS_POTION:
        this.setDirectFrame(1);
        break;
      case TreasureFamily.INVULNERABLE_POTION:
        this.setDirectFrame(2);
        break;
      case TreasureFamily.FLIGHT_POTION:
        this.setDirectFrame(11);
        break;
      case TreasureFamily.SPEED_POTION:
        this.setDirectFrame(3);
        break;
      default:
        break;
    }
  }

  private applyGeneratorType(family: number): void {
    this.stats.weaponCost = 0;
    switch (family) {
      case GeneratorFamily.TOWER:
        this.defaultWeapon = L.MAGE;
        break;
      case GeneratorFamily.BONES:
        this.defaultWeapon = L.GHOST;
        break;
      case GeneratorFamily.TREEHOUSE:
        this.defaultWeapon = L.ELF;
        break;
      default:
        this.defaultWeapon = L.SKELETON;
        break;
    }
  }

  // --- Small helpers -----------------------------------------------------------

  setActType(num: number): void {
    this.oldActType = this.actType;
    this.actType = num;
  }

  restoreActType(): void {
    this.actType = this.oldActType;
  }

  setFrame(frame: number): void {
    if (frame >= 0) this.frame = frame;
  }

  setDirectFrame(frame: number): void {
    this.frame = frame;
  }

  isType(order: number, family: number): boolean {
    return this.order === order && this.family === family;
  }

  /** Manhattan distance between top-left corners (walker::distance_to_ob). */
  distanceTo(target: Walker): number {
    return Math.abs(target.xpos - this.xpos) + Math.abs(target.ypos - this.ypos);
  }

  /** Squared distance between centres. */
  distanceToCenter(target: Walker): number {
    const dx = target.xpos - this.xpos + idiv(target.sizex - this.sizex, 2);
    const dy = target.ypos - this.ypos + idiv(target.sizey - this.sizey, 2);
    return dx * dx + dy * dy;
  }

  centerOn(target: Walker): void {
    this.setxy(
      target.xpos + idiv(target.sizex, 2) - idiv(this.sizex, 2),
      target.ypos + idiv(target.sizey, 2) - idiv(this.sizey, 2),
    );
  }

  /** The top of an ownership chain (weapon -> summon -> caster). */
  head(): Walker {
    let head: Walker = this;
    while (head.owner && !head.owner.dead && head.owner !== head) head = head.owner;
    return head;
  }

  isFriendly(target: Walker | null): boolean {
    if (!target || this.dead || target.dead) return false;
    const us = this.head();
    const them = target.head();
    const bothCharacters = us.myguy !== null && them.myguy !== null;
    if (!this.world.alliedMode || !bothCharacters) return us.teamNum === them.teamNum;
    return true;
  }

  // --- Movement ------------------------------------------------------------------

  setxy(x: number, y: number): void {
    if (!this.ignore) this.world.obmap.move(this, x, y);
    else this.world.obmap.remove(this);
    this.xpos = x;
    this.ypos = y;
  }

  move(dx: number, dy: number): void {
    this.setxy(this.xpos + dx, this.ypos + dy);
  }

  /** Eight-way facing for a direction vector (walker::facing). */
  facing(x: number, y: number): number {
    if (!x) return y > 0 ? Face.DOWN : Face.UP;
    const slope = idiv(y * 1000, x);
    if (x > 0) {
      if (slope > 2414) return Face.DOWN;
      if (slope > 414) return Face.DOWN_RIGHT;
      if (slope > -414) return Face.RIGHT;
      if (slope > -2414) return Face.UP_RIGHT;
      return Face.UP;
    }
    if (slope > 2414) return Face.UP;
    if (slope > 414) return Face.UP_LEFT;
    if (slope > -414) return Face.LEFT;
    if (slope > -2414) return Face.DOWN_LEFT;
    return Face.DOWN;
  }

  /** Advances the walk cycle and shows its frame. */
  protected stepAnimation(): void {
    this.cycle++;
    if (aniFrame(this.ani, this.curdir, this.cycle) === -1) this.cycle = 0;
    this.setFrame(aniFrame(this.ani, this.curdir, this.cycle));
  }

  /** Repeats the last step. */
  walkLast(): number {
    return this.walk(this.lastx, this.lasty);
  }

  /** Moves by (x, y) pixels if facing that way, otherwise turns toward it first. */
  walk(x: number, y: number): number {
    const dir = this.facing(x, y);
    if (this.isType(Order.LIVING, L.TOWER1)) {
      this.curdir = dir;
      return 1;
    }
    if (!x && !y) return 1;
    if (this.curdir === dir) {
      if (!this.inWorld(this.xpos + x, this.ypos + y)) return 0;
      if (this.world.queryPassable(this.xpos + x, this.ypos + y, this)) {
        this.move(x, y);
        this.stepAnimation();
        return 1;
      }
      if (this.stats.hasFlag(Bit.ANIMATE)) this.stepAnimation();
      return 0;
    }
    this.curdir = dir;
    this.cycle = 0;
    this.setFrame(aniFrame(this.ani, this.curdir, 0));
    this.move(0, 0);
    return 1;
  }

  protected inWorld(x: number, y: number): boolean {
    return x >= 0 && x < this.world.pixmaxx && y >= 0 && y < this.world.pixmaxy;
  }

  /**
   * One step in a unit direction (-1..1 each axis). If blocked, try a one-pixel step, then
   * (for the AI) sidestep along an axis, or (for players) slide along walls diagonally.
   */
  walkstep(x: number, y: number): number {
    const oldCurdir = this.curdir;
    const step = this.stepsize;
    this.lastx = x * step;
    this.lasty = y * step;

    if (this.isType(Order.LIVING, L.TOWER1)) {
      this.curdir = this.facing(x, y);
      this.enddir = this.curdir;
      this.lastx = x;
      this.lasty = y;
      return 1;
    }
    let result = this.walk(x * step, y * step);
    if (result) return result;
    result = this.walk(x, y); // baby step
    if (result) return result;

    let ret1 = 0;
    let ret2 = 0;
    const dir = this.facing(x, y);
    if (this.user === -1) {
      switch (dir) {
        case Face.UP:
          this.curdir = Face.LEFT;
          ret1 = this.walk(-step, 0);
          break;
        case Face.RIGHT:
          this.curdir = Face.UP;
          ret1 = this.walk(0, -step);
          break;
        case Face.DOWN:
          this.curdir = Face.RIGHT;
          ret1 = this.walk(step, 0);
          break;
        case Face.LEFT:
          this.curdir = Face.DOWN;
          ret1 = this.walk(0, step);
          break;
        default: {
          // Diagonal: try the vertical then the horizontal component.
          this.curdir = y < 0 ? Face.UP : Face.DOWN;
          ret1 = this.walk(0, y * step);
          this.curdir = x < 0 ? Face.LEFT : Face.RIGHT;
          ret2 = this.walk(x * step, 0);
          break;
        }
      }
    } else if (dir % 2 === 1) {
      // Players slide along walls one pixel at a time when walking diagonally.
      const myCycle = this.cycle;
      let gotUp = false;
      let gotOver = false;
      for (let i = 0; i < step; i++) {
        if (this.world.queryPassable(this.xpos, this.ypos + y, this)) {
          this.move(0, y);
          gotUp = true;
        }
        if (this.world.queryPassable(this.xpos + x, this.ypos, this)) {
          this.move(x, 0);
          gotOver = true;
        }
        if (!gotUp && gotOver) this.curdir = x > 0 ? Face.RIGHT : Face.LEFT;
        else if (gotUp && !gotOver) this.curdir = y > 0 ? Face.DOWN : Face.UP;
        if (gotUp || gotOver) {
          this.cycle = myCycle + 1;
          if (aniFrame(this.ani, this.curdir, this.cycle) === -1) this.cycle = 0;
          this.setFrame(aniFrame(this.ani, this.curdir, this.cycle));
        }
      }
    }
    this.curdir = oldCurdir;
    return ret1 || ret2 ? 1 : 0;
  }

  /** Rotates one eighth toward `targetdir` and points our next step that way. */
  turn(targetdir: number): number {
    const distance = this.curdir - targetdir;
    if ((distance >= -4 && distance < 0) || distance >= 4) this.curdir = (this.curdir + 1) % 8;
    else this.curdir = (this.curdir + 7) % 8;
    if (!this.isType(Order.LIVING, L.TOWER1)) {
      const [dx, dy] = faceDelta(this.curdir);
      this.lastx = dx * this.stepsize;
      this.lasty = dy * this.stepsize;
    }
    this.cycle = 0;
    this.setFrame(aniFrame(this.ani, this.curdir, 0));
    this.move(0, 0);
    return 1;
  }

  // --- Combat ----------------------------------------------------------------------

  /** Starts an attack toward (xdir, ydir): turn if needed, then play the attack animation. */
  initFire(xdir = this.lastx, ydir = this.lasty): number {
    const want = this.facing(xdir, ydir);
    if (want !== this.curdir) this.enddir = want;
    if (this.curdir !== this.enddir && this.order === Order.LIVING) {
      if (this.actType === Act.CONTROL) return 0;
      return this.turn(this.enddir);
    }
    if (this.busy > 0) return 0;
    if (this.isType(Order.LIVING, L.SOLDIER) && this.weaponsLeft < 1) return 0;
    this.busy = int8(this.busy + this.fireFrequency);
    if (this.aniType === Ani.WALK) {
      this.aniType = Ani.ATTACK;
      this.cycle = 0;
      this.animate();
      return 1;
    }
    return this.fire() ? 1 : 0;
  }

  /** Spawns our weapon (or, for generators, a monster) in front of us. */
  fire(): Walker | null {
    const s = this.stats;
    if (s.magicpoints < s.weaponCost) return null;
    if (this.isType(Order.LIVING, L.SOLDIER) && this.weaponsLeft < 1) return null;
    const weapon = this.createWeapon();
    if (!weapon) return null;
    s.magicpoints -= s.weaponCost;

    this.setWeaponHeading(weapon);
    weapon.setFrame(this.frame);
    weapon.curdir = (this.frame + 1) % 2;

    const world = this.world;
    if (!world.queryPassable(weapon.xpos, weapon.ypos, weapon)) {
      // Point blank: hit whatever is in the way directly.
      const target = weapon.collideOb;
      if (target && !target.dead) {
        if (this.attack(target)) world.sound('clang', this);
        if (this.myguy) this.myguy.totalShots++;
      }
      weapon.dead = true;
      return null;
    }
    if (s.hasFlag(Bit.NO_RANGED)) {
      weapon.dead = true;
      return null;
    }

    if (this.myguy) this.myguy.totalShots++;
    if (this.isType(Order.LIVING, L.SOLDIER)) this.weaponsLeft--;
    world.sound(weaponSound(weapon.family), this);

    if (this.order === Order.GENERATOR) {
      const rng = world.rng;
      switch (this.family) {
        case GeneratorFamily.TOWER:
        case GeneratorFamily.TREEHOUSE:
          if (this.family === GeneratorFamily.TOWER) weapon.aniType = Ani.TELE_IN; // mages teleport in
          weapon.stats.level = rng.random(s.level) + 1;
          weapon.setDifficulty(weapon.stats.level);
          weapon.owner = null;
          break;
        default:
          weapon.lifetime = 800 + s.level * 11;
          weapon.stats.level = rng.random(s.level) + 1;
          weapon.setDifficulty(weapon.stats.level);
          break;
      }
    } else if (this.isType(Order.LIVING, L.ARCHMAGE)) {
      const extra = idiv(s.magicpoints, 20);
      s.magicpoints -= extra;
      weapon.damage += extra;
    }
    return weapon;
  }

  /** Places a weapon just outside us in our last walking direction, with a little random spread. */
  setWeaponHeading(weapon: Walker): void {
    let waver = int8(idiv(weapon.stepsize, 2));
    waver = int8(this.world.rng.random(waver + 1) - idiv(waver, 2));
    const { xpos, ypos, sizex, sizey } = this;
    const ws = weapon.stepsize;
    const midX = xpos + idiv(sizex - weapon.sizex, 2);
    const midY = ypos + idiv(sizey - weapon.sizey, 2);
    const left = xpos - weapon.sizex - 1;
    const right = xpos + sizex + 1;
    const above = ypos - weapon.sizey - 1;
    const below = ypos + sizey + 1;
    switch (this.facing(this.lastx, this.lasty)) {
      case Face.RIGHT:
        weapon.setxy(right, midY);
        [weapon.lastx, weapon.lasty] = [ws, waver];
        break;
      case Face.LEFT:
        weapon.setxy(left, midY);
        [weapon.lastx, weapon.lasty] = [-ws, waver];
        break;
      case Face.DOWN:
        weapon.setxy(midX, below);
        [weapon.lastx, weapon.lasty] = [waver, ws];
        break;
      case Face.UP:
        weapon.setxy(midX, above);
        [weapon.lastx, weapon.lasty] = [waver, -ws];
        break;
      case Face.UP_RIGHT:
        weapon.setxy(right, above);
        [weapon.lastx, weapon.lasty] = [ws + waver, -ws + waver];
        break;
      case Face.UP_LEFT:
        weapon.setxy(left, above);
        [weapon.lastx, weapon.lasty] = [-ws - waver, -ws + waver];
        break;
      case Face.DOWN_RIGHT:
        weapon.setxy(right, below);
        [weapon.lastx, weapon.lasty] = [ws - waver, ws + waver];
        break;
      case Face.DOWN_LEFT:
        weapon.setxy(left, below);
        [weapon.lastx, weapon.lasty] = [-ws + waver, ws + waver];
        break;
    }
  }

  createWeapon(): Walker | null {
    const world = this.world;
    const s = this.stats;
    if (this.order === Order.GENERATOR) {
      const spawn = world.addOb(Order.LIVING, this.defaultWeapon);
      spawn.teamNum = this.teamNum;
      spawn.owner = this;
      spawn.setDifficulty(s.level);
      return spawn;
    }
    const weapon = world.addOb(Order.WEAPON, this.currentWeapon);
    weapon.teamNum = this.teamNum;
    weapon.owner = this;
    weapon.setDifficulty(s.level);
    weapon.damage = idiv(weapon.damage * (s.level + 3), 4);
    if (this.myguy) {
      weapon.lineofsight += idiv(this.myguy.strength, 23) + idiv(this.myguy.dexterity, 31);
      weapon.damage += idiv(this.myguy.strength, 7);
    } else {
      weapon.damage *= s.level;
    }
    weapon.lineofsight += idiv(s.level, 3);
    if (this.facing(this.lastx, this.lasty) % 2 === 0) {
      // Cardinal shots get extra range and speed so overall range is roughly circular.
      weapon.lineofsight = idiv(weapon.lineofsight * 309, 256);
      weapon.stepsize = idiv(weapon.stepsize * 362, 256);
    }
    if (this.family === L.CLERIC) {
      weapon.aniType = Ani.GLOWGROW;
      weapon.lifetime += s.level * 110;
    }
    return weapon;
  }

  /**
   * Would a shot toward (xdelta, ydelta) reach our foe? Traces a test weapon along its path
   * (walker::fire_check).
   */
  fireCheck(xdelta: number, ydelta: number): number {
    if (this.order === Order.GENERATOR) return 1;
    if (this.isType(Order.LIVING, L.SOLDIER) && this.weaponsLeft < 1) return 0;
    const weapon = this.createWeapon();
    if (!weapon) return 0;
    this.setWeaponHeading(weapon);
    weapon.collideOb = null;
    // The original returns here without discarding the probe, leaving it in flight.
    if (!this.foe) return 0;

    const s = this.stats;
    const world = this.world;
    const fail = (result: number) => {
      weapon.dead = true;
      return result;
    };
    if (s.hasFlag(Bit.NO_RANGED)) return fail(0);
    if (s.weaponCost > s.magicpoints) return fail(0);
    if (this.distanceTo(this.foe) > weapon.stepsize * weapon.lineofsight) return fail(0);
    if (this.facing(xdelta, ydelta) !== this.curdir) return fail(0);

    for (let i = 0; i < weapon.lineofsight; i++) {
      weapon.setxy(weapon.xpos + i * weapon.lastx, weapon.ypos + i * weapon.lasty);
      if (!world.queryGridPassable(weapon.xpos, weapon.ypos, weapon)) return fail(0);
      if (!world.queryObjectPassable(weapon.xpos, weapon.ypos, weapon)) return fail(1);
    }
    return fail(0);
  }

  /** Is something solid right next to us in our walking direction? */
  queryNextTo(): number {
    let x = this.xpos;
    let y = this.ypos;
    if (this.lastx > 0) x += this.sizex;
    else if (this.lastx < 0) x -= this.sizex;
    if (this.lasty > 0) y += this.sizey;
    else y -= this.sizey;
    return this.world.queryObjectPassable(x, y, this) ? 0 : 1;
  }

  /** Deals our damage to `target`, awarding experience and score, and kills it if needed. */
  attack(target: Walker): number {
    const world = this.world;
    const getScore = this.myguy !== null || this.teamNum === 0;
    if (target.dead) return 0;
    if (this.isFriendly(target) || target.order === Order.TREASURE) return 0;
    if (target.stats.hasFlag(Bit.INVINCIBLE) || target.invulnerableLeft !== 0) return 0;

    const attacker = this.order !== Order.LIVING && this.owner ? this.owner : this;
    let headguy: Walker = this;
    while (headguy.owner && headguy.owner !== headguy) headguy = headguy.owner;

    let damage = this.damage;
    if (target.order === Order.LIVING) {
      if (attacker.myguy) attacker.myguy.totalHits++;
      const magical = this.stats.hasFlag(Bit.MAGICAL);
      if (magical && (target.family === L.SLIME || target.family === L.SMALL_SLIME || target.family === L.MEDIUM_SLIME)) {
        damage *= 2;
      } else if (magical && target.family === L.BARBARIAN) {
        damage = idiv(damage, 2);
      }
    } else if (attacker.myguy) {
      attacker.myguy.totalShots--;
    }

    damage -= world.rng.random(target.stats.armor);
    if (damage < 0) damage = 0;
    if (attacker.myguy && target.order === Order.LIVING) attacker.myguy.totalDamage += damage;
    target.stats.hitpoints -= damage;
    if (target.stats.hitpoints < 0) damage += target.stats.hitpoints;

    let newexp = idiv(damage * (target.stats.level + 2), 2);
    if (this.order === Order.WEAPON && this.owner) newexp = idiv(newexp, this.owner.stats.level || 1);
    else newexp = idiv(newexp, this.stats.level || 1);
    if (newexp < 1) newexp = 1;
    if (this.order === Order.WEAPON && this.owner) {
      if (this.owner.actType !== Act.CONTROL) newexp *= 3;
    } else if (this.order === Order.LIVING && this.actType !== Act.CONTROL) {
      newexp *= 3;
    }

    if (this.order !== Order.LIVING && this.owner) {
      this.owner.foe = target;
      target.stats.hitResponse(this.owner);
      if (headguy.myguy) headguy.myguy.exp += target.order !== Order.LIVING ? idiv(newexp, 3) : newexp;
    } else {
      target.stats.hitResponse(this);
      if (this.myguy) {
        if (target.order !== Order.LIVING) {
          this.myguy.exp += idiv(newexp, 3);
        } else {
          this.myguy.exp += newexp;
          if (getScore) world.addScore(this.teamNum, damage + target.stats.level);
        }
      }
    }

    if (this.order === Order.WEAPON) {
      this.stats.hitpoints -= damage;
      this.damage--;
      if (this.stats.hitpoints <= 0) {
        if (!this.stats.hasFlag(Bit.IMMORTAL)) this.dead = true;
        this.death();
      }
      if (this.family === W.SPRINKLE && target.order === Order.LIVING && this.owner) {
        // Faerie dust freezes its victim.
        const base = 40 + this.owner.stats.level * 2;
        const range = target.myguy ? base - idiv(target.myguy.constitution, 21) : base;
        target.stats.frozenDelay = Math.max(0, world.rng.random(range));
      }
    }

    const playerTeam = 0;
    if (this.owner && target.order !== Order.WEAPON && playerTeam !== target.teamNum) {
      if (getScore) world.addScore(this.teamNum, damage + target.stats.level);
      if (headguy.myguy) headguy.myguy.exp += newexp;
    }

    if (target.stats.hitpoints <= 0) {
      if (target.order === Order.LIVING) {
        this.reportKill(target, headguy, getScore, damage, newexp);
        const blood = world.addOb(Order.WEAPON, W.BLOOD);
        blood.teamNum = target.teamNum;
        blood.aniType = Ani.GROW;
        blood.ignore = true;
        blood.setxy(target.xpos, target.ypos);
        world.sound(world.rng.random(2) ? 'die1' : 'die2', this);
      }
      target.dead = true;
      target.death();
    }
    this.collideOb = null;
    return 1;
  }

  private reportKill(target: Walker, headguy: Walker, getScore: boolean, damage: number, newexp: number): void {
    const world = this.world;
    const name = target.stats.name;
    if (target.teamNum !== 0) {
      if (headguy.myguy) {
        headguy.myguy.exp += newexp + 8 * target.stats.level;
        headguy.myguy.kills++;
        headguy.myguy.levelKills += target.stats.level;
      }
      if (getScore) world.addScore(this.teamNum, damage + 10 * target.stats.level);
      if (name && !target.lifetime && !target.owner) world.message(`ENEMY DEATH: ${name} DIED!`);
      if (world.remainingFoes(0) === 1) world.message('All foes defeated!');
      return;
    }
    if ((target.owner || target.lifetime) && name) world.message(`${name} Dispelled!`);
    else if (name) world.message(`${name} DIED!`);
    else if (target.myguy?.name) world.message(`${target.myguy.name} Died!`);
    else world.message(FAMILY_DEATH_MESSAGES[target.family] ?? 'SOMEONE DIED');
  }

  // --- Behaviour -------------------------------------------------------------------

  /** One game tick. */
  act(): number {
    if (this.foe?.dead) this.foe = null;
    if (this.leader?.dead) this.leader = null;
    if (this.owner?.dead) this.owner = null;
    this.collideOb = null;
    if (this.aniType !== Ani.WALK) return this.animate();
    if (this.stats.frozenDelay) {
      this.stats.frozenDelay--;
      return 1;
    }
    if (this.busy > 0) this.busy--;
    if (this.stats.commands.length && this.stats.doCommand()) return 1;

    const rng = this.world.rng;
    switch (this.actType) {
      case Act.CONTROL:
        return 1;
      case Act.GENERATE:
        this.actGenerate();
        return 0;
      case Act.FIRE:
        this.actFire();
        return 1;
      case Act.GUARD:
        this.actGuard();
        return 0;
      case Act.DIE:
        this.dead = true;
        return 1;
      case Act.RANDOM:
        if (!rng.random(4)) {
          if (!rng.random(20)) {
            if (!this.special()) this.stats.tryCommand(Command.WALK, rng.random(30), rng.random(3) - 1, rng.random(3) - 1);
            return 1;
          }
          this.actRandom();
        } else {
          this.foe ??= this.world.findFarFoe(this);
          if (this.foe) this.stats.tryCommand(Command.SEARCH, 500, 0, 0);
          return 1;
        }
        return 0;
      default:
        return 0;
    }
  }

  /** Plays the current non-walking animation, triggering what happens at its end. */
  animate(): number {
    const index = this.curdir + this.aniType * NUM_FACINGS;
    this.setFrame(aniFrame(this.ani, index, this.cycle));
    this.cycle++;
    if (aniFrame(this.ani, index, this.cycle) !== -1) return 1;

    if (this.aniType === Ani.ATTACK) {
      this.fire();
      this.aniType = Ani.WALK;
      this.cycle = 0;
      return 1;
    }
    if (this.aniType === Ani.SKEL_GROW && this.isType(Order.LIVING, L.SKELETON)) {
      this.aniType = Ani.WALK;
      this.cycle = 0;
      return 1;
    }
    if (this.aniType === Ani.TELE_OUT && this.order === Order.LIVING) {
      this.cycle = 0;
      if (this.family === L.MAGE || this.family === L.ARCHMAGE) {
        this.aniType = Ani.TELE_IN;
        this.teleport();
        return 1;
      }
      if (this.family === L.SKELETON) {
        this.aniType = Ani.TELE_IN;
        this.teleportRanged(this.stats.level * 18);
        return 1;
      }
      this.aniType = Ani.WALK;
      return 0;
    }
    if (this.aniType === Ani.SLIME_SPLIT && this.order === Order.LIVING) {
      this.aniType = Ani.WALK;
      this.cycle = 0;
      this.splitSlime();
      return 1;
    }
    this.aniType = Ani.WALK;
    this.cycle = 0;
    return 1;
  }

  private splitSlime(): void {
    this.transformTo(Order.LIVING, L.SMALL_SLIME);
    this.setxy(this.xpos - 10, this.ypos + 10);
    const twin = this.world.addOb(Order.LIVING, L.SMALL_SLIME);
    twin.setxy(this.xpos + 12, this.ypos - 12);
    this.transferStats(twin);
    if (twin.myguy && this.myguy && twin.myguy.exp < 1000 * this.stats.level) {
      // Too inexperienced to keep the split-off half as a squad member.
      twin.myguy = null;
      twin.stats.name = 'SLIME';
      twin.stats.level = calculateLevel(idiv(this.myguy.exp, 2));
    } else if (twin.myguy && this.myguy) {
      this.myguy.exp = idiv(this.myguy.exp, 2);
      twin.myguy.exp = idiv(twin.myguy.exp, 2);
      twin.myguy.level = calculateLevel(twin.myguy.exp);
      twin.stats.level = twin.myguy.level;
    }
    twin.teamNum = this.teamNum;
    twin.foe = this.foe;
    twin.leader = this.leader;
  }

  /** Generators spawn a monster now and then, less often the more there already are. */
  protected actGenerate(): void {
    const world = this.world;
    const rng = world.rng;
    if (world.numobs < 150 && rng.random(this.stats.level * 3) > rng.random(300 + world.numobs * 8)) {
      this.lastx = 1 - rng.random(3);
      this.lasty = 1 - rng.random(3);
      if (!this.lastx && !this.lasty) this.lastx = 1;
      this.initFire(this.lastx, this.lasty);
      this.stats.hitpoints++;
      if (this.stats.hitpoints > this.stats.maxHitpoints) this.stats.hitpoints--;
    }
  }

  /** Projectiles fly until their range runs out or they hit something. */
  protected actFire(): void {
    if (!this.lineofsight--) {
      this.dead = true;
      this.death();
    } else if (!this.walkLast() || this.stats.hasFlag(Bit.NO_COLLIDE)) {
      if (this.collideOb && !this.collideOb.dead) this.attack(this.collideOb);
      if (!this.stats.hasFlag(Bit.IMMORTAL)) {
        this.dead = true;
        this.death();
      }
    }
  }

  protected actGuard(): number {
    this.foe = this.world.findNearFoe(this);
    if (!this.foe) return 0;
    this.curdir = this.facing(this.foe.xpos - this.xpos, this.foe.ypos - this.ypos);
    this.stats.tryCommand(Command.FIRE, this.world.rng.random(30));
    return 1;
  }

  protected actRandom(): number {
    const world = this.world;
    if (!world.rng.random(70) || !this.foe) this.foe = world.findFarFoe(this);
    if (!this.foe) return this.stats.tryCommand(Command.RANDOM_WALK, 20);
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
    this.collideOb = null;
    return this.walkstep(Math.sign(dx), Math.sign(dy));
  }

  /** How many of the 8 neighbouring body-sized spaces are free. */
  spacesClear(): number {
    let count = 0;
    for (let i = -1; i < 2; i++) {
      for (let j = -1; j < 2; j++) {
        if ((i || j) && this.world.queryPassable(this.xpos + i * this.sizex, this.ypos + j * this.sizey, this)) count++;
      }
    }
    return count;
  }

  // --- Virtual hooks overridden by subclasses --------------------------------------

  collide(ob: Walker): number {
    this.collideOb = ob;
    return 1;
  }

  shove(_target: Walker, _x: number, _y: number): number {
    return -1;
  }

  eatMe(_eater: Walker): number {
    return 0;
  }

  doSummon(_family: number, _lifetime: number): Walker | null {
    return null;
  }

  checkSpecial(): number {
    return 0;
  }

  /** Special abilities (walker::special). Not ported yet; the AI simply skips them. */
  special(): number {
    return 0;
  }

  setDifficulty(level: number): void {
    const dif = this.world.difficultyPercent;
    const s = this.stats;
    if (this.order === Order.GENERATOR) {
      s.hitpoints = idiv(100 * level * dif, 100);
    } else if (this.teamNum !== 0) {
      s.maxHitpoints = idiv(s.maxHitpoints * dif, 100);
      s.maxMagicpoints = idiv(s.maxMagicpoints * dif, 100);
      this.damage = idiv(this.damage * dif, 100);
    }
  }

  // --- Teleporting, transforming and dying -------------------------------------------

  /** Mage teleport: to our marker if we placed one, otherwise somewhere random. */
  teleport(): number {
    const world = this.world;
    for (const marker of world.oblist) {
      if (marker.isType(Order.FX, FxFamily.MARKER) && marker.owner === this && !marker.dead) {
        const distance = this.distanceTo(marker);
        if (world.queryPassable(marker.xpos, marker.ypos, this) && distance > 64) {
          this.centerOn(marker);
          if (--marker.lifetime < 1) {
            marker.dead = true;
            marker.death();
          }
          return 1;
        }
        if (this.user !== -1 && distance > 64) world.notify('Marker is Blocked!', this);
      }
    }
    for (let tries = 0; tries < 10000; tries++) {
      const x = world.rng.random(world.maxx) * GRID_SIZE;
      const y = world.rng.random(world.maxy) * GRID_SIZE;
      if (world.queryPassable(x, y, this)) {
        this.setxy(x, y);
        return 1;
      }
    }
    return 0;
  }

  teleportRanged(range: number): number {
    const rng = this.world.rng;
    for (let tries = 200; tries > 0; tries--) {
      const x = rng.random(2 * range) - range + this.xpos;
      const y = rng.random(2 * range) - range + this.ypos;
      if (this.world.queryPassable(x, y, this)) {
        this.setxy(x, y);
        return 1;
      }
    }
    return 0;
  }

  transferStats(target: Walker): void {
    const from = this.stats;
    const to = target.stats;
    to.hitpoints = from.hitpoints;
    to.maxHitpoints = from.maxHitpoints;
    to.healPerRound = from.healPerRound;
    to.maxHealDelay = from.maxHealDelay;
    to.magicpoints = from.magicpoints;
    to.maxMagicpoints = from.maxMagicpoints;
    to.magicPerRound = idiv(from.magicPerRound, 2);
    to.maxMagicDelay = from.maxMagicDelay;
    to.level = from.level;
    to.frozenDelay = from.frozenDelay;
    for (let i = 0; i < 5; i++) to.specialCost[i] = from.specialCost[i];
    to.weaponCost = from.weaponCost;
    to.bitFlags = from.bitFlags;
    to.deleteMe = from.deleteMe;
    if (this.myguy) target.myguy = this.myguy.clone();
  }

  /** Changes into another kind of object in place, keeping our centre. */
  transformTo(order: number, family: number): void {
    const world = this.world;
    world.obmap.remove(this);
    const sameOrder = this.order === order;
    const keepAct = this.actType;
    this.stats.bitFlags = 0;
    this.applyType(order, family);
    const cx = this.xpos + idiv(this.sizex, 2);
    const cy = this.ypos + idiv(this.sizey, 2);
    this.loadSprite();
    this.frame = 0;
    this.cycle = 0;
    if (sameOrder) this.setActType(keepAct);
    // Like the original, an unchanged position leaves us out of the collision map until we move.
    this.setxy(cx - idiv(this.sizex, 2), cy - idiv(this.sizey, 2));
    this.setFrame(0);
    this.animate();
  }

  /** Called once when we are destroyed. */
  death(): number {
    if (this.deathCalled) return 0;
    this.deathCalled = true;
    const world = this.world;

    if (this.myguy) {
      // A fallen squad member leaves a life gem worth part of their value.
      const gem = world.addOb(Order.TREASURE, TreasureFamily.LIFE_GEM);
      gem.stats.hitpoints = idiv(this.myguy.heartValue() * 3, 8);
      gem.teamNum = this.teamNum;
      gem.centerOn(this);
    }

    switch (this.order) {
      case Order.LIVING:
        if ((this.teamNum === 0 || this.myguy) && world.scenarioType & ScenType.SAVE_ALL && this.stats.name) {
          world.fail(`${this.stats.name} has fallen!`);
          return 0;
        }
        switch (this.family) {
          case L.FIREELEMENTAL:
            this.dead = false;
            this.stats.magicpoints += this.stats.specialCost[1];
            this.special(); // explode
            this.dead = true;
            break;
          case L.SLIME:
            this.shrinkInto(L.MEDIUM_SLIME);
            break;
          case L.MEDIUM_SLIME:
            this.shrinkInto(L.SMALL_SLIME);
            break;
          case L.GHOST:
          case L.SKELETON:
          case L.TOWER1:
            break; // no bloodstains
          default:
            this.generateBloodspot();
            break;
        }
        break;
      case Order.GENERATOR:
        for (let i = 0; i < 4; i++) {
          const boom = world.addOb(Order.FX, FxFamily.EXPLOSION);
          boom.teamNum = this.teamNum;
          boom.stats.level = this.stats.level;
          boom.aniType = Ani.EXPLODE;
          boom.setxy(this.xpos + world.rng.random(this.sizex - 8) + 4, this.ypos + 4 + world.rng.random(this.sizey - 8));
          boom.damage = this.stats.level * 2;
          boom.setFrame(world.rng.random(3));
          world.sound('explode', this);
        }
        break;
      default:
        break;
    }
    return 1;
  }

  private shrinkInto(family: number): void {
    this.dead = true;
    const child = this.world.addOb(Order.LIVING, family);
    child.teamNum = this.teamNum;
    child.stats.level = this.stats.level;
    child.setDifficulty(this.stats.level);
    child.foe = this.foe;
    child.leader = this.leader;
    if (this.myguy) {
      child.myguy = this.myguy;
      this.myguy = null;
    }
    child.centerOn(this);
    this.stats.hitpoints = this.stats.maxHitpoints;
  }

  generateBloodspot(): void {
    this.dead = true;
    const stain = this.world.addFxOb(Order.TREASURE, TreasureFamily.STAIN);
    stain.ignore = true;
    this.transferStats(stain);
    stain.stats.oldOrder = this.order;
    stain.stats.oldFamily = this.family;
    stain.teamNum = this.teamNum;
    stain.dead = false;
    stain.setxy(this.xpos, this.ypos);
    stain.setFrame(this.world.rng.random(4));
    stain.aniType = Ani.WALK;
  }
}

function weaponSound(family: number): string {
  switch (family) {
    case W.FIREBALL:
    case W.METEOR:
      return 'blast';
    case W.SPRINKLE:
      return 'sparkle';
    case W.ARROW:
    case W.FIRE_ARROW:
      return 'bow';
    case W.LIGHTNING:
      return 'bolt';
    default:
      return 'fwip';
  }
}

