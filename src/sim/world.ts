// The battlefield (screen.cpp): object lists, terrain queries, foe finding and the per-tick
// update loop. Pure logic with no rendering, so it can run headless in tests.

import type { MapGrid } from '../data/assets.ts';
import { LivingFamily as L, Order, SpecialFamily, TreasureFamily, WeaponFamily as W } from '../data/objects.ts';
import type { ScenarioObject } from '../formats/scenario.ts';
import { Act, Bit, DEFAULT_DIFFICULTY, ScenType, DIFFICULTY_LEVELS, Genre, GRID_SIZE, MAX_SPREAD } from './constants.ts';
import { Effect } from './effect.ts';
import type { Guy } from './guy.ts';
import { Living, regenRate } from './living.ts';
import { idiv, Rng } from './math.ts';
import { ObMap } from './obmap.ts';
import { NO_INPUT, PlayerController, type PlayerInput } from './player.ts';
import { GRASS_DAMAGED, OUTSIDE_TILE, SCORCHABLE, tileClass, TileClass, tileGenre } from './terrain.ts';
import { typeInfo } from './tables.ts';
import { Treasure } from './treasure.ts';
import { Walker } from './walker.ts';
import { Weapon } from './weapon.ts';

export interface SpriteInfo {
  width: number;
  height: number;
  frames: number;
}

/** Things the presentation layer may want to show or play. */
export type WorldEvent =
  | { type: 'sound'; sound: string; x: number; y: number }
  | { type: 'notify'; message: string; who: number }
  | { type: 'message'; message: string }
  | { type: 'exit'; level: number; who: number };

export type Outcome = { result: 'victory'; exitTo?: number } | { result: 'defeat'; reason: string };

export interface WorldOptions {
  map: MapGrid;
  objects: readonly ScenarioObject[];
  scenarioType?: number;
  /** Sprite dimensions per order/family; collision boxes come from these. */
  spriteInfo: (order: number, family: number) => SpriteInfo | null;
  seed?: number;
  difficulty?: number;
  /** The player's squad, placed on the scenario's team markers. */
  squad?: readonly Guy[];
  /** Number of human players; 0 lets the AI fight the whole battle. */
  players?: number;
}

export class World {
  readonly maxx: number;
  readonly maxy: number;
  readonly pixmaxx: number;
  readonly pixmaxy: number;
  readonly grid: Uint8Array;
  readonly rng: Rng;
  readonly obmap = new ObMap();
  readonly spriteInfo: (order: number, family: number) => SpriteInfo | null;
  readonly difficultyPercent: number;
  readonly scenarioType: number;
  /** Livings, generators, effects and dropped life gems. New objects go to the front. */
  oblist: Walker[] = [];
  /** Projectiles, blood and doors. New objects go to the front. */
  weaplist: Walker[] = [];
  /** Floor items: treasure, exits, stains, open doors. New objects go to the back. */
  fxlist: Walker[] = [];
  /** Livings ever created. The original never decrements it, so generators wind down over time. */
  numobs = 0;
  score: number[] = new Array(8).fill(0);
  alliedMode = false;
  enemyFreeze = 0;
  myTeam = 0;
  /** 0: foes remain, 1: no foes but an exit, 2: no foes or exits (victory). */
  levelDone = 0;
  ticks = 0;
  outcome: Outcome | null = null;
  /** Shared walk_to_foe counter (a function static in the original). */
  searchCounter = 0;
  events: WorldEvent[] = [];
  readonly players: PlayerController[];
  private idCounter = 0;

  constructor(options: WorldOptions) {
    const { map } = options;
    this.maxx = map.width;
    this.maxy = map.height;
    this.pixmaxx = map.width * GRID_SIZE;
    this.pixmaxy = map.height * GRID_SIZE;
    this.grid = Uint8Array.from(map.tiles);
    this.spriteInfo = options.spriteInfo;
    this.rng = new Rng(options.seed ?? 1);
    this.difficultyPercent = DIFFICULTY_LEVELS[options.difficulty ?? DEFAULT_DIFFICULTY];
    this.scenarioType = options.scenarioType ?? 0;

    for (const ob of options.objects) this.placeScenarioObject(ob);
    // game.cpp: scale every placed object by its level and the difficulty.
    for (const ob of [...this.oblist]) ob.setDifficulty(ob.stats.level);
    this.placeSquad(options.squad ?? []);
    this.players = Array.from({ length: options.players ?? 1 }, (_, i) => new PlayerController(this, i, 0));
    for (const p of this.players) p.update(NO_INPUT);
  }

  nextId(): number {
    return ++this.idCounter;
  }

  // --- Setup -------------------------------------------------------------------

  private placeScenarioObject(spec: ScenarioObject): void {
    const ob = spec.order === Order.TREASURE ? this.addFxOb(spec.order, spec.family) : this.addOb(spec.order, spec.family);
    ob.setxy(spec.x, spec.y);
    ob.teamNum = spec.team;
    ob.stats.level = spec.level;
    ob.stats.name = spec.name;
    if (spec.name.length > 1) ob.stats.setFlag(Bit.NAMED, true);
    if (ob.isType(Order.WEAPON, W.DOOR) && this.genreAt(idiv(ob.xpos, GRID_SIZE), idiv(ob.ypos, GRID_SIZE) - 1) === Genre.WALL) {
      ob.setFrame(1); // doors in vertical walls turn sideways
    }
  }

  /** game.cpp: turn each squad member into a unit and put it on a team marker. */
  private placeSquad(squad: readonly Guy[]): void {
    for (const guy of squad) {
      const unit = this.addOb(Order.LIVING, guy.family);
      const s = unit.stats;
      unit.myguy = guy;
      s.level = guy.level;
      s.maxHitpoints = 10 + guy.constitution * 3 + idiv(guy.strength, 2) + 25 * guy.level;
      s.hitpoints = s.maxHitpoints;
      unit.damage += idiv(guy.strength, 4) + guy.level + idiv(guy.dexterity, 11);
      s.maxMagicpoints = 10 + guy.intelligence * 3 + 25 * guy.level + guy.dexterity;
      s.magicpoints = s.maxMagicpoints;
      s.armor = guy.armor + idiv(guy.dexterity, 14) + guy.level;
      [s.healPerRound, s.maxHealDelay] = regenRate(guy.constitution + idiv(guy.strength, 6) + guy.level * 2 + 20, s.healPerRound);
      s.currentHealDelay = 0;
      [s.magicPerRound, s.maxMagicDelay] = regenRate(guy.intelligence * 45 + guy.level * 60 + guy.dexterity * 15 + 200, s.magicPerRound);
      s.currentMagicDelay = 0;
      unit.stepsize = Math.min(unit.stepsize + idiv(guy.dexterity, 54), 12);
      unit.normalStepsize = unit.stepsize;
      unit.fireFrequency = Math.max(1, unit.fireFrequency - idiv(guy.dexterity, 47));
      if (unit.family === L.SOLDIER) unit.weaponsLeft = idiv(s.level + 1, 2);
      unit.teamNum = guy.teamnum;
      unit.realTeamNum = 255;

      const marker = this.firstOf(Order.SPECIAL, SpecialFamily.RESERVED_TEAM, guy.teamnum) ?? this.firstOf(Order.SPECIAL, SpecialFamily.RESERVED_TEAM);
      if (marker) {
        unit.setxy(marker.xpos, marker.ypos);
        marker.dead = true;
      } else {
        unit.teleport();
      }
    }
    for (const marker of this.oblist) if (marker.order === Order.SPECIAL) marker.dead = true;
    this.cleanup();
  }

  // --- Object creation -----------------------------------------------------------

  /** loader::create_walker */
  private createWalker(order: number, family: number): Walker {
    let ob: Walker;
    switch (order) {
      case Order.LIVING:
        ob = new Living(this, order, family);
        break;
      case Order.WEAPON:
        ob = new Weapon(this, order, family);
        break;
      case Order.TREASURE:
        ob = new Treasure(this, order, family);
        break;
      case Order.FX:
        ob = new Effect(this, order, family);
        break;
      default:
        ob = new Walker(this, order, family);
        break;
    }
    const hp = typeInfo(order, family).hitpoints;
    ob.stats.hitpoints = hp;
    ob.stats.maxHitpoints = hp;
    ob.stats.specialCost[0] = 0;
    ob.stats.weaponCost = 1;
    ob.applyType(order, family);
    return ob;
  }

  /** Adds to the main list (weapons go to the weapon list), at the front. */
  addOb(order: number, family: number): Walker {
    if (order === Order.WEAPON) return this.addWeapOb(order, family);
    const ob = this.createWalker(order, family);
    this.oblist.unshift(ob);
    if (order === Order.LIVING) this.numobs++;
    return ob;
  }

  addWeapOb(order: number, family: number): Walker {
    const ob = this.createWalker(order, family);
    this.weaplist.unshift(ob);
    return ob;
  }

  addFxOb(order: number, family: number): Walker {
    const ob = this.createWalker(order, family);
    this.fxlist.push(ob);
    return ob;
  }

  firstOf(order: number, family: number, team = -1): Walker | null {
    return this.oblist.find((ob) => !ob.dead && ob.isType(order, family) && (team === -1 || ob.teamNum === team)) ?? null;
  }

  /** Every object currently in play, for rendering. */
  *allObjects(): Iterable<Walker> {
    yield* this.fxlist;
    yield* this.weaplist;
    yield* this.oblist;
  }

  // --- Terrain ----------------------------------------------------------------------

  tileAt(gx: number, gy: number): number {
    if (gx < 0 || gy < 0 || gx >= this.maxx || gy >= this.maxy) return OUTSIDE_TILE;
    return this.grid[gx + gy * this.maxx];
  }

  /** Terrain genre of a grid cell (smoother::query_genre_x_y). */
  genreAt(gx: number, gy: number): number {
    return tileGenre(this.tileAt(gx, gy));
  }

  /** Can `ob`'s bounding box stand at (x, y) as far as terrain goes? */
  queryGridPassable(x: number, y: number, ob: Walker): boolean {
    const xover = x + ob.sizex;
    const yover = y + ob.sizey;
    if (x < 0 || y < 0 || xover >= this.pixmaxx || yover >= this.pixmaxy) return false;
    const s = ob.stats;
    if (s.hasFlag(Bit.ETHEREAL)) return true;
    const xEnd = idiv(xover, GRID_SIZE) + (xover % GRID_SIZE ? 1 : 0);
    const yEnd = idiv(yover, GRID_SIZE) + (yover % GRID_SIZE ? 1 : 0);
    const flying = s.hasFlag(Bit.FLYING) || ob.flightLeft > 0;
    const isWeapon = ob.order === Order.WEAPON;

    for (let i = idiv(x, GRID_SIZE); i < xEnd; i++) {
      for (let j = idiv(y, GRID_SIZE); j < yEnd; j++) {
        switch (tileClass(this.grid[i + this.maxx * j])) {
          case TileClass.OPEN:
            break;
          case TileClass.TREE_TOP:
            if (!s.hasFlag(Bit.FORESTWALK) && !flying) return false;
            break;
          case TileClass.TREE_BOTTOM:
            if (!isWeapon && !s.hasFlag(Bit.FORESTWALK) && !flying) return false;
            break;
          case TileClass.WALL:
            return false;
          case TileClass.ARROW_SLIT: {
            if (ob.order === Order.LIVING) return false;
            // Missiles slip through more easily the closer they were shot from.
            const shooter = ob.owner ?? ob;
            let dist = Math.max(Math.abs(ob.xpos - shooter.xpos), Math.abs(ob.ypos - shooter.ypos)) - GRID_SIZE / 2;
            if (dist < GRID_SIZE) dist += GRID_SIZE;
            if (this.rng.random(idiv(dist, GRID_SIZE))) return false;
            if (!isWeapon && !flying) return false;
            break;
          }
          case TileClass.LOW:
            if (!isWeapon && !flying) return false;
            break;
          default:
            return false;
        }
      }
    }
    return true;
  }

  queryObjectPassable(x: number, y: number, ob: Walker): boolean {
    if (ob.dead) return true;
    return this.obmap.isClear(ob, x, y);
  }

  queryPassable(x: number, y: number, ob: Walker): boolean {
    return this.queryGridPassable(x, y, ob) && this.queryObjectPassable(x, y, ob);
  }

  /** Explosions scorch grass. */
  damageTile(x: number, y: number): void {
    const gx = idiv(x, GRID_SIZE);
    const gy = idiv(y, GRID_SIZE);
    if (gx < 0 || gy < 0 || gx >= this.maxx || gy >= this.maxy) return;
    const i = gy * this.maxx + gx;
    if (SCORCHABLE.has(this.grid[i])) {
      this.grid[i] = GRASS_DAMAGED;
      this.tileChanges.push(i);
    }
  }

  /** Grid indices changed since the renderer last looked. */
  tileChanges: number[] = [];

  // --- Finding things -------------------------------------------------------------------

  private canSee(ob: Walker): boolean {
    return this.rng.random(idiv(ob.invisibilityLeft, 20)) === 0;
  }

  /** Spirals outward through the collision map for a nearby enemy (screen::find_near_foe). */
  findNearFoe(ob: Walker): Walker | null {
    let tx = ob.xpos;
    let ty = ob.ypos;
    let resolution = this.obmap.resolution;
    let spread = 1;
    let xchange = 0;
    while (spread < MAX_SPREAD) {
      for (let loop = 0; loop < spread; loop++) {
        if (!(xchange % 2)) {
          tx += resolution;
          if (tx <= 0 || tx >= this.pixmaxx) return this.findFarFoe(ob);
        } else {
          ty += resolution;
          if (ty <= 0 || ty >= this.pixmaxy) return this.findFarFoe(ob);
        }
        for (const other of this.obmap.cellAt(tx, ty)) {
          if (!other.dead && !ob.isFriendly(other) && this.canSee(other) && (other.order === Order.LIVING || other.order === Order.GENERATOR)) {
            return other;
          }
        }
      }
      xchange++;
      if (!(xchange % 2)) {
        resolution = -resolution;
        spread++;
      }
    }
    return this.findFarFoe(ob);
  }

  /** The closest enemy anywhere (screen::find_far_foe). */
  findFarFoe(ob: Walker): Walker | null {
    let best: Walker | null = null;
    let distance = 10000;
    ob.stats.lastDistance = 10000;
    for (const foe of this.oblist) {
      if (foe.dead || ob.isFriendly(foe)) continue;
      if ((foe.order === Order.LIVING || foe.order === Order.GENERATOR) && this.canSee(foe)) {
        const d = ob.distanceTo(foe);
        if (d < distance) {
          distance = d;
          best = foe;
        }
      }
    }
    return best;
  }

  findInRange(range: number, ob: Walker): Walker[] {
    return this.oblist.filter((o) => !o.dead && ob.distanceTo(o) <= range);
  }

  findFoesInRange(range: number, ob: Walker): Walker[] {
    return this.oblist.filter(
      (o) => !o.dead && (o.order === Order.LIVING || o.order === Order.GENERATOR) && !ob.isFriendly(o) && ob.distanceTo(o) <= range,
    );
  }

  findFriendsInRange(range: number, ob: Walker): Walker[] {
    return this.oblist.filter((o) => !o.dead && o.order === Order.LIVING && ob.isFriendly(o) && ob.distanceTo(o) <= range);
  }

  /**
   * Weapons near `ob`. The original searches the main list (where weapons never are) and checks
   * for *friendly* weapons, so shields and boomerangs never actually block missiles; we keep that.
   */
  findFoeWeaponsInRange(range: number, ob: Walker): Walker[] {
    return this.oblist.filter((o) => !o.dead && o.order === Order.WEAPON && ob.isFriendly(o) && ob.distanceTo(o) <= range);
  }

  findNearestPlayer(ob: Walker): Walker | null {
    let best: Walker | null = null;
    let distance = 32000;
    for (const o of this.oblist) {
      if (o.user === -1) continue;
      const d = ob.distanceTo(o);
      if (d < distance) {
        distance = d;
        best = o;
      }
    }
    return best;
  }

  /** Who COMMAND_FOLLOW should follow: the unit player 1 controls. */
  followLeaderFor(_ob: Walker): Walker | null {
    return this.oblist.find((o) => !o.dead && o.user === 0) ?? null;
  }

  findNearestBlood(who: Walker): Walker | null {
    let best: Walker | null = null;
    let distance = 800;
    for (const o of this.fxlist) {
      if (o.dead || !o.isType(Order.TREASURE, TreasureFamily.STAIN)) continue;
      const d = who.distanceToCenter(o);
      if (d < distance) {
        distance = d;
        best = o;
      }
    }
    return best;
  }

  remainingFoes(team: number): number {
    return this.oblist.filter((o) => !o.dead && o.order === Order.LIVING && o.teamNum !== team).length;
  }

  // --- Events -----------------------------------------------------------------------

  sound(sound: string, at: Walker): void {
    this.events.push({ type: 'sound', sound, x: at.xpos, y: at.ypos });
  }

  /** A message about a specific unit (screen::do_notify). */
  notify(message: string, who: Walker): void {
    this.events.push({ type: 'notify', message, who: who.id });
  }

  /** A general battle message. */
  message(message: string): void {
    this.events.push({ type: 'message', message });
  }

  addScore(team: number, amount: number): void {
    if (team >= 0 && team < this.score.length) this.score[team] += amount;
  }

  /** A player-controlled unit stepped on an exit. */
  reachExit(level: number, who: Walker): void {
    // Leaving needs the field cleared, unless the scenario allows exiting early.
    if (this.levelDone === 0 && this.scenarioType !== ScenType.CAN_EXIT) {
      if (!who.skipExit || who.skipExit === 10) this.notify('Defeat all foes before leaving!', who);
      return;
    }
    this.events.push({ type: 'exit', level, who: who.id });
    this.outcome ??= { result: 'victory', exitTo: level };
  }

  fail(reason: string): void {
    this.outcome ??= { result: 'defeat', reason };
  }

  // --- The tick ------------------------------------------------------------------------

  /** Advances the battle one game tick (screen::act), then applies each player's input. */
  tick(inputs: readonly PlayerInput[] = []): void {
    if (this.outcome) return;
    this.ticks++;
    this.levelDone = 2;
    if (this.enemyFreeze) this.enemyFreeze--;

    for (const ob of [...this.oblist]) {
      if (ob.dead) continue;
      const frozen = this.enemyFreeze && ob.teamNum !== 0 && (ob.order === Order.LIVING || ob.order === Order.GENERATOR);
      if (frozen) continue;
      ob.inAct = true;
      ob.act();
      ob.inAct = false;
      if (!ob.dead) {
        if (ob.teamNum !== this.myTeam && ob.order === Order.LIVING) this.levelDone = 0;
        if (!this.enemyFreeze && !ob.foe && !ob.leader) ob.foe = this.findFarFoe(ob);
      }
    }
    for (const ob of [...this.weaplist]) {
      if (ob.dead) continue;
      ob.act();
      if (!ob.dead && ob.teamNum !== this.myTeam && ob.order === Order.LIVING) this.levelDone = 0;
    }
    if (this.levelDone !== 0 && this.fxlist.some((o) => !o.dead && o.isType(Order.TREASURE, TreasureFamily.EXIT))) {
      this.levelDone = 1;
    }

    for (const ob of this.allObjects()) ob.drawcycle = (ob.drawcycle + 1) & 0xff;
    this.cleanup();

    if (this.levelDone === 2) this.outcome ??= { result: 'victory' };
    if (this.outcome) return;

    let anyoneLeft = this.players.length === 0;
    this.players.forEach((p, i) => (anyoneLeft = p.update(inputs[i] ?? NO_INPUT) || anyoneLeft));
    if (!anyoneLeft || !this.oblist.some((o) => !o.dead && o.order === Order.LIVING && o.teamNum === this.myTeam)) {
      this.outcome = { result: 'defeat', reason: 'YOUR MEN ARE CRUSHED!' };
    }
  }

  /** Forgets references to the dead and removes them from play. */
  private cleanup(): void {
    for (const ob of [...this.oblist, ...this.weaplist]) {
      if (ob.foe?.dead) ob.foe = null;
      if (ob.leader?.dead) ob.leader = null;
      if (ob.owner?.dead) ob.owner = null;
      if (ob.collideOb?.dead) ob.collideOb = null;
    }
    const keep = (list: Walker[]) =>
      list.filter((ob) => {
        if (!ob.dead) return true;
        this.obmap.remove(ob);
        return false;
      });
    this.oblist = keep(this.oblist);
    this.fxlist = keep(this.fxlist);
    this.weaplist = keep(this.weaplist);
  }

  /** Puts a squad member under player control (view.cpp). */
  takeControl(ob: Walker, player = 0): void {
    ob.user = player;
    ob.setActType(Act.CONTROL);
  }
}
