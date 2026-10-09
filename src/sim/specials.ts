// Special abilities for every family (walker.cpp special()). A special costs
// specialCost[currentSpecial] magic, charged only when it goes off. Like the original this
// always reports 0 to its caller, which the AI relies on.

import { FxFamily as F, LivingFamily as L, Order, TreasureFamily, WeaponFamily as W } from '../data/objects.ts';
import { Act, Ani, Bit, Command } from './constants.ts';
import { idiv, sign } from './math.ts';
import type { Walker } from './walker.ts';

/** Directions round a full circle, starting up and going clockwise. */
const COMPASS: readonly (readonly [number, number])[] = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

/** The eight neighbours in the original's i/j loop order. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
];

export function performSpecial(w: Walker): number {
  const s = w.stats;
  if (w.dead) return 0;
  if (s.magicpoints < (s.specialCost[w.currentSpecial] ?? 5000)) return 0;
  if (w.order !== Order.LIVING) return 0;
  if (!SPECIALS[w.family]?.(w)) return 0;
  s.magicpoints -= s.specialCost[w.currentSpecial];
  return 0;
}

/** Each returns true if the special went off (and should be paid for). */
type Special = (w: Walker) => boolean;

const SPECIALS: Partial<Record<number, Special>> = {
  [L.ARCHER]: archer,
  [L.SOLDIER]: soldier,
  [L.CLERIC]: cleric,
  [L.MAGE]: mage,
  [L.ARCHMAGE]: archmage,
  [L.FIREELEMENTAL]: fireElemental,
  [L.SMALL_SLIME]: (w) => (w.currentSpecial === 1 ? slimeGrow(w) : slimeAcid(w)),
  [L.MEDIUM_SLIME]: (w) => (w.currentSpecial === 1 ? slimeGrow(w) : slimeAcid(w)),
  [L.SLIME]: (w) => {
    if (w.currentSpecial !== 1) return slimeAcid(w);
    w.aniType = Ani.SLIME_SPLIT; // splits when the animation ends
    w.cycle = 0;
    return true;
  },
  [L.FAERIE]: faerie,
  [L.GHOST]: (w) => {
    if (w.currentSpecial === 2) return lifeDrain(w);
    if (w.currentSpecial === 3) return bansheeWail(w);
    const scare = w.world.addOb(Order.FX, F.GHOST_SCARE);
    scare.aniType = Ani.SCARE;
    scare.setxy(w.xpos + idiv(w.sizex, 2) - idiv(scare.sizex, 2), w.ypos + idiv(w.sizey, 2) - idiv(scare.sizey, 2));
    scare.owner = w;
    scare.stats.level = w.stats.level;
    scare.teamNum = w.teamNum;
    return true;
  },
  [L.THIEF]: thief,
  [L.ELF]: elf,
  [L.DRUID]: druid,
  [L.ORC]: orc,
  [L.SKELETON]: (w) => {
    if (w.currentSpecial === 2) {
      // Bone storm: bones in every direction.
      fireAllDirections(w);
      return true;
    }
    if (w.currentSpecial === 3) return raiseTheDead(w);
    // Tunnel: sink into the ground and pop up nearby.
    if (w.aniType === Ani.TELE_OUT || w.aniType === Ani.TELE_IN) return false;
    w.aniType = Ani.TELE_OUT;
    w.cycle = 0;
    return true;
  },
  [L.BARBARIAN]: barbarian,
};

// --- Helpers ------------------------------------------------------------------------

function fireAllDirections(w: Walker, each?: (weapon: Walker) => void): void {
  const [x, y] = [w.lastx, w.lasty];
  for (const [i, j] of NEIGHBOURS) {
    w.lastx = i;
    w.lasty = j;
    const weapon = w.fire();
    if (weapon) each?.(weapon);
  }
  w.lastx = x;
  w.lasty = y;
}

/** A small magical blast on a foe (it doesn't hurt the caster). */
function blastOn(w: Walker, foe: Walker, damage: number): void {
  const boom = w.world.addOb(Order.FX, F.EXPLOSION);
  boom.owner = w;
  boom.teamNum = w.teamNum;
  boom.stats.level = w.stats.level;
  boom.stats.setFlag(Bit.MAGICAL, true);
  boom.damage = damage;
  boom.centerOn(foe);
  boom.aniType = Ani.EXPLODE;
  boom.skipExit = 100; // magical: stays small, spares the caster
}

/** Magic beyond the special's cost, used to power some spells up. */
function excessMagic(w: Walker, slot = w.currentSpecial): number {
  return w.stats.magicpoints - w.stats.specialCost[slot];
}

function displayName(w: Walker, fallback: string): string {
  return w.stats.name || w.myguy?.name || fallback;
}

function onPlayerTeam(w: Walker): boolean {
  return w.teamNum === 0 || w.myguy !== null;
}

function placeMarker(w: Walker, notifyEvenForAi: boolean): void {
  const world = w.world;
  const old = world.oblist.find((o) => o.isType(Order.FX, F.MARKER) && o.owner === w && !o.dead);
  if (old) {
    old.dead = true;
    old.death();
    if (onPlayerTeam(w) && (notifyEvenForAi || w.user !== -1)) world.notify('(Old Marker Removed)', w);
    w.busy += 8;
  }
  const marker = world.addOb(Order.FX, F.MARKER);
  marker.owner = w;
  marker.centerOn(w);
  marker.lifetime = w.myguy ? idiv(w.myguy.intelligence, 33) : idiv(w.stats.level, 4) + 1;
  marker.aniType = Ani.SPIN;
  if (onPlayerTeam(w) && (notifyEvenForAi || w.user !== -1)) {
    world.notify('Teleport Marker Placed', w);
    world.notify(`(${marker.lifetime} Uses)`, w);
  }
  w.busy += 8;
  w.stats.magicpoints -= idiv(excessMagic(w), 2);
}

/** Mage and archmage teleport: either drop a marker (alternate) or vanish and reappear. */
function teleport(w: Walker, checkIntForMarker: boolean): boolean {
  if (w.aniType === Ani.TELE_OUT || w.aniType === Ani.TELE_IN) return false;
  if (w.shifterDown) {
    if (w.busy) return false;
    if (w.myguy && w.myguy.intelligence < 75) {
      if (!checkIntForMarker || w.user !== -1) w.world.notify('Need 75 Int for Marker!', w);
      return false;
    }
    placeMarker(w, !checkIntForMarker);
    return true;
  }
  w.world.sound('teleport', w);
  w.aniType = Ani.TELE_OUT;
  w.cycle = 0;
  return true;
}

/** Heartburst: an explosion on every enemy in range, sharing half our spare magic. */
function burst(w: Walker, range: number, costSlot: number): boolean {
  const world = w.world;
  const foes = world.findFoesInRange(range, w);
  if (!foes.length) return false;
  const power = idiv(idiv(excessMagic(w, costSlot), 2), foes.length);
  if (w.myguy) w.myguy.totalShots += foes.length;
  w.busy += 5;
  for (const foe of foes) {
    const boom = world.addOb(Order.FX, F.EXPLOSION);
    boom.owner = w;
    boom.teamNum = w.teamNum;
    boom.stats.level = w.stats.level;
    boom.stats.setFlag(Bit.MAGICAL, true);
    boom.damage = power;
    boom.centerOn(foe);
    world.sound('explode', w);
    boom.aniType = Ani.EXPLODE;
    boom.skipExit = 100; // magical: doesn't hurt the caster
    w.stats.magicpoints -= power;
  }
  return true;
}

/** Destroys nearby skeletons and ghosts (cleric's alternate specials). */
function turnUndead(w: Walker): boolean {
  const world = w.world;
  if (w.busy) return false;
  if (w.myguy && w.myguy.intelligence < 60) {
    if (onPlayerTeam(w)) world.notify('You need 60 Int to Turn Undead', w);
    w.busy += 5;
    return false;
  }
  const range = 4 * w.stats.level;
  const foes = world.findFoesInRange(range, w);
  if (!foes.length) return false;
  let turned = 0;
  for (const foe of foes) {
    if (foe.family !== L.SKELETON && foe.family !== L.GHOST) continue;
    if (world.rng.random(range * 40) > world.rng.random(foe.stats.level * 10)) {
      foe.dead = true;
      foe.stats.hitpoints = 0;
      w.attack(foe);
      turned++;
    }
  }
  if (w.myguy && turned) {
    w.myguy.exp += turned * 3;
    world.notify(`${w.myguy.name} turned ${turned} undead.`, w);
  }
  world.sound('heal', w);
  return true;
}

/** Raise a summoned undead from the nearest bloodstain within `reach`. */
function raiseFromBlood(w: Walker, family: number, lifetime: number, reach: number, exp: number): boolean {
  const world = w.world;
  const stain = world.findNearestBlood(w);
  if (!stain) return false;
  if (!world.queryPassable(stain.xpos, stain.ypos, stain) || w.distanceTo(stain) >= reach) return false;
  const risen = w.doSummon(family, lifetime);
  if (!risen) return false;
  risen.teamNum = w.teamNum;
  risen.stats.level = world.rng.random(w.stats.level) + 1;
  risen.setDifficulty(risen.stats.level);
  risen.setxy(stain.xpos, stain.ypos);
  risen.owner = w;
  stain.dead = true;
  if (w.myguy) w.myguy.exp += exp;
  return true;
}

/** Find a free spot next to us for a newly summoned unit. */
function placeBeside(w: Walker, summoned: Walker): boolean {
  for (const [i, j] of NEIGHBOURS) {
    const x = w.xpos + (summoned.sizex + 1) * i;
    const y = w.ypos + (summoned.sizey + 1) * j;
    if (w.world.queryPassable(x, y, summoned)) {
      summoned.setxy(x, y);
      return true;
    }
  }
  return false;
}

// --- Families --------------------------------------------------------------------------

function archer(w: Walker): boolean {
  const s = w.stats;
  switch (w.currentSpecial) {
    case 1: {
      // Fire arrows in a full circle.
      w.curdir = -1;
      w.lastx = 0;
      w.lasty = 0;
      s.magicpoints += 8 * s.weaponCost;
      s.addCommand(Command.SET_WEAPON, 1, W.FIRE_ARROW, 0);
      for (const [dx, dy] of COMPASS) s.addCommand(Command.QUICK_FIRE, 1, dx, dy);
      s.addCommand(Command.RESET_WEAPON, 1, 0, 0);
      return true;
    }
    case 2:
      // Barrage: three arrows at once.
      if (w.busy) return false;
      s.magicpoints += 3 * s.weaponCost;
      w.fire();
      w.fire();
      w.fire();
      w.busy += w.fireFrequency * 2;
      return true;
    default: {
      // Exploding bolt.
      if (w.busy) return false;
      const weapon = w.currentWeapon;
      w.currentWeapon = W.FIRE_ARROW;
      const bolt = w.fire();
      w.currentWeapon = weapon;
      if (!bolt) return false;
      bolt.skipExit = 5000; // marks it as exploding
      bolt.stats.hitpoints = 500;
      bolt.damage *= 2;
      return true;
    }
  }
}

function soldier(w: Walker): boolean {
  const world = w.world;
  const s = w.stats;
  switch (w.currentSpecial) {
    case 1:
      // Charge: rush forward, knocking back whoever we hit.
      if (s.forwardBlocked()) return false;
      s.addCommand(Command.RUSH, 3, idiv(w.lastx, w.stepsize || 1), idiv(w.lasty, w.stepsize || 1));
      world.sound('charge', w);
      return true;
    case 2: {
      const boomerang = world.addOb(Order.FX, F.BOOMERANG);
      boomerang.owner = w;
      boomerang.teamNum = w.teamNum;
      boomerang.aniType = 1;
      boomerang.lifetime = 30 + s.level * 12;
      boomerang.stats.hitpoints += s.level * 12;
      boomerang.stats.maxHitpoints = boomerang.stats.hitpoints;
      boomerang.damage += s.level * 4;
      return true;
    }
    case 3: {
      // Whirlwind: spin round, striking and throwing back everyone close.
      if (w.busy) return false;
      w.busy += 8;
      w.curdir = -1;
      w.lastx = 0;
      w.lasty = 0;
      for (const [dx, dy] of COMPASS) s.addCommand(Command.WALK, 1, dx, dy);
      for (const foe of world.findFoesInRange(32 + s.level * 2, w)) {
        w.attack(foe);
        foe.stats.forceCommand(Command.WALK, 8, sign(foe.xpos - w.xpos), sign(foe.ypos - w.ypos));
      }
      return true;
    }
    case 4: {
      // Disarm: stall the enemies right in front of us.
      if (w.busy) return false;
      if (!s.forwardBlocked()) return false;
      const foes = world.findFoesInRange(28, w);
      if (!foes.length) return false;
      for (const foe of foes) {
        if (world.rng.random(s.level) >= world.rng.random(foe.stats.level)) foe.busy += 6 * (s.level - foe.stats.level + 1);
      }
      world.sound('charge', w);
      if (onPlayerTeam(w)) world.notify('Fighter Disarmed Enemy!', w);
      w.busy += 5;
      return true;
    }
    default:
      return true;
  }
}

function cleric(w: Walker): boolean {
  const world = w.world;
  const s = w.stats;
  switch (w.currentSpecial) {
    case 1: {
      if (!w.shifterDown) {
        // Heal everyone nearby.
        const friends = world.findFriendsInRange(60, w);
        if (friends.length <= 1) return false;
        let healed = 0;
        for (const friend of friends) {
          if (friend === w || friend.stats.hitpoints >= friend.stats.maxHitpoints) continue;
          const amount = world.rng.random(s.level * 5);
          friend.stats.hitpoints += amount;
          if (w.myguy) w.myguy.exp += idiv(world.rng.random(20 * amount), s.level || 1);
          healed++;
        }
        if (!healed) return false; // everyone was healthy: don't charge us
        if (onPlayerTeam(w)) world.notify(healed === 1 ? 'Cleric healed 1 man!' : `Cleric healed ${healed} men!`, w);
        world.sound('heal', w);
        return true;
      }
      // Mystic mace: a spinning shield that strikes enemies.
      if (w.busy) return false;
      if (w.myguy && w.myguy.intelligence < 50) {
        if (w.user !== -1) world.notify('50 Int required for Mystic Mace!', w);
        return false;
      }
      if (w.myguy) w.myguy.totalShots++;
      const mace = world.addOb(Order.FX, F.MAGIC_SHIELD);
      mace.owner = w;
      mace.teamNum = w.teamNum;
      mace.aniType = 1;
      const extra = idiv(excessMagic(w), 2);
      mace.lifetime = 100 + extra;
      mace.stats.hitpoints += idiv(extra, 2);
      mace.damage += idiv(extra, 4);
      s.magicpoints -= extra;
      w.busy += 5;
      return true;
    }
    case 2:
      return w.shifterDown ? turnUndead(w) : raiseFromBlood(w, L.SKELETON, 125 + s.level * 40, 60, 45);
    case 3:
      return w.shifterDown ? turnUndead(w) : raiseFromBlood(w, L.GHOST, 150 + s.level * 40, 30, 60);
    default:
      return resurrect(w);
  }
}

/** Bring a fallen ally back at half health, or raise a fallen enemy as our ghost. */
function resurrect(w: Walker): boolean {
  const world = w.world;
  const stain = world.findNearestBlood(w);
  if (!stain) return false;
  if (!world.queryPassable(stain.xpos, stain.ypos, stain) || w.distanceTo(stain) >= 30) return false;
  let alive: Walker | null;
  if (w.isFriendly(stain)) {
    alive = world.addOb(Order.LIVING, stain.stats.oldFamily);
    stain.transferStats(alive);
    alive.stats.hitpoints = idiv(alive.stats.maxHitpoints, 2);
    alive.teamNum = stain.teamNum;
    if (w.myguy) {
      const penalty = stain.stats.level * stain.stats.level * 100;
      w.myguy.exp = Math.max(0, w.myguy.exp - penalty);
    }
  } else {
    alive = w.doSummon(L.GHOST, 200);
    if (!alive) return false;
    alive.teamNum = w.teamNum;
    alive.stats.level = world.rng.random(w.stats.level) + 1;
    alive.setDifficulty(alive.stats.level);
    alive.owner = w;
  }
  alive.setxy(stain.xpos, stain.ypos);
  stain.dead = true;
  if (w.myguy) w.myguy.exp += 90;
  return true;
}

function mage(w: Walker): boolean {
  const world = w.world;
  const s = w.stats;
  switch (w.currentSpecial) {
    case 1:
      return teleport(w, true);
    case 2: {
      // Warp space: slow fireballs in every direction, stronger with spare magic.
      let bonus = excessMagic(w);
      if (bonus > 0) {
        bonus = idiv(bonus, 15);
        s.magicpoints -= bonus;
      } else {
        bonus = 0;
      }
      s.magicpoints += 8 * s.weaponCost;
      fireAllDirections(w, (fireball) => {
        fireball.damage += bonus;
        fireball.lineofsight += idiv(bonus, 3);
        fireball.lastx = sign(fireball.lastx);
        fireball.lasty = sign(fireball.lasty);
      });
      return true;
    }
    case 3:
      freezeTime(w);
      return true;
    case 4: {
      // Energy wave: a growing wall of force.
      const shot = w.fire();
      if (!shot) return false;
      const wave = world.addOb(Order.WEAPON, W.WAVE);
      wave.centerOn(shot);
      wave.owner = w;
      wave.stats.level = s.level;
      wave.lastx = shot.lastx;
      wave.lasty = shot.lasty;
      shot.dead = true;
      return true;
    }
    default:
      return burst(w, 80 + 2 * s.level, 5);
  }
}

/** Freeze time: our side gets free rounds while everyone else stands still. */
function freezeTime(w: Walker): void {
  const world = w.world;
  if (onPlayerTeam(w)) {
    world.enemyFreeze += 20 + 11 * w.stats.level;
    world.events.push({ type: 'freeze', ticks: world.enemyFreeze });
    return;
  }
  const rounds = Math.min(5 + 2 * w.stats.level, 50);
  world.message(`TIME IS FROZEN! (${rounds} rounds)`);
  for (const friend of world.findFriendsInRange(30000, w)) friend.bonusRounds += rounds;
}

function archmage(w: Walker): boolean {
  const world = w.world;
  const s = w.stats;
  switch (w.currentSpecial) {
    case 1:
      return teleport(w, false);
    case 2: {
      if (w.busy) return false;
      if (!w.shifterDown) return burst(w, 80 + 2 * s.level, 2);
      // Chain lightning: a bolt that leaps from foe to foe.
      const range = (w.myguy ? 200 + idiv(w.myguy.intelligence, 2) : 200 + s.level * 5) + 2 * s.level;
      const foes = world.findFoesInRange(range, w);
      if (!foes.length) return false;
      w.busy += 5;
      if (w.myguy) w.myguy.totalShots++;
      const bolt = world.addOb(Order.FX, F.CHAIN);
      bolt.centerOn(w);
      bolt.owner = w;
      bolt.stats.level = s.level;
      bolt.teamNum = w.teamNum;
      const power = idiv(excessMagic(w, 2), 2);
      s.magicpoints -= power;
      bolt.damage = power;
      bolt.leader = foes.reduce((best, foe) => (w.distanceToCenter(best) > w.distanceToCenter(foe) ? foe : best));
      return true;
    }
    case 3:
      if (w.busy) return false;
      return w.shifterDown ? summonElemental(w) : summonIllusion(w);
    case 4:
      return mindControl(w);
    default:
      return true;
  }
}

function summonElemental(w: Walker): boolean {
  const world = w.world;
  const s = w.stats;
  if (w.myguy && w.myguy.intelligence < 150) {
    if (w.user !== -1) world.notify('150 Int required to Summon!', w);
    return false;
  }
  s.magicpoints -= idiv(excessMagic(w, 3), 2);
  const elemental = world.addOb(Order.LIVING, L.FIREELEMENTAL);
  if (!placeBeside(w, elemental)) {
    elemental.dead = true;
    return false;
  }
  elemental.stats.level = idiv(s.level + 1, 2);
  elemental.setDifficulty(elemental.stats.level);
  elemental.teamNum = w.teamNum;
  elemental.owner = w;
  elemental.lifetime = 200 + 60 * s.level;
  w.busy += 15;
  return true;
}

/** Summon image: a phantom fighter that vanishes at the first hit. Stronger with spare magic. */
function summonIllusion(w: Walker): boolean {
  const world = w.world;
  const s = w.stats;
  const spare = excessMagic(w, 3);
  const pools: readonly number[][] = [
    [L.ELF],
    [L.ELF, L.SOLDIER, L.ARCHER],
    [L.ELF, L.SOLDIER, L.ARCHER, L.ORC, L.SKELETON],
    [L.ELF, L.SOLDIER, L.ARCHER, L.ORC, L.SKELETON, L.DRUID, L.CLERIC],
    [L.ELF, L.SOLDIER, L.ARCHER, L.ORC, L.SKELETON, L.DRUID, L.CLERIC, L.FIREELEMENTAL, L.BIG_ORC],
  ];
  const tier = spare < 100 ? 0 : spare < 250 ? 1 : spare < 500 ? 2 : spare < 1000 ? 3 : 4;
  const pool = pools[tier];
  const image = world.addOb(Order.LIVING, pool[world.rng.random(pool.length)]);
  if (!placeBeside(w, image)) {
    image.dead = true;
    return false;
  }
  image.stats.level = idiv(s.level + 2, 3);
  image.setDifficulty(image.stats.level);
  image.teamNum = w.teamNum;
  image.owner = w;
  image.lifetime = 100 + 20 * s.level;
  image.stats.maxHitpoints = 1;
  image.stats.hitpoints = 0;
  image.stats.armor = 0;
  image.foe = w.foe;
  image.stats.setFlag(Bit.MAGICAL, true);
  image.stats.name = 'Phantom';
  w.busy += 15;
  return true;
}

function mindControl(w: Walker): boolean {
  const world = w.world;
  const s = w.stats;
  const rng = world.rng;
  if (w.busy) return false;
  const foes = world.findFoesInRange(80 + 4 * s.level, w);
  if (!foes.length) return false;
  let budget = excessMagic(w) + 10;
  let controlled = 0;
  for (const foe of foes) {
    if (budget < 10) break;
    if (foe.realTeamNum !== 255 || foe.order !== Order.LIVING || foe.charmLeft > 10) continue;
    budget -= 10;
    const edge = s.level - foe.stats.level;
    foe.realTeamNum = foe.teamNum;
    if (edge < 0 || !rng.random(20)) {
      foe.teamNum = rng.random(8); // too strong: confused instead
    } else {
      foe.teamNum = w.teamNum;
      foe.foe = null;
    }
    foe.charmLeft = 25 + rng.random(edge * 20);
    controlled++;
  }
  if (!controlled) return false;
  world.notify(`${displayName(w, 'ArchMage')} has controlled ${controlled} men`, w);
  w.busy += 10;
  return true;
}

function slimeGrow(w: Walker): boolean {
  if (w.spacesClear() > 7) {
    w.transformTo(Order.LIVING, w.family === L.SMALL_SLIME ? L.MEDIUM_SLIME : L.SLIME);
    return true;
  }
  const rng = w.world.rng;
  w.stats.setCommand(Command.WALK, 10, rng.random(3) - 1, rng.random(3) - 1);
  return false;
}

function thief(w: Walker): boolean {
  const world = w.world;
  const s = w.stats;
  const rng = world.rng;
  switch (w.currentSpecial) {
    case 1: {
      const bomb = world.addOb(Order.FX, F.BOMB);
      bomb.aniType = Ani.BOMB;
      if (w.myguy) w.myguy.totalShots++;
      bomb.damage = (s.level + 1) * 15;
      bomb.setxy(w.xpos + idiv(w.sizex, 2) - idiv(bomb.sizex, 2), w.ypos + idiv(w.sizey, 2) - idiv(bomb.sizey, 2));
      bomb.owner = w;
      if (w.user === -1) {
        // The AI runs from its own bomb.
        let dx = rng.random(3) - 1;
        const dy = rng.random(3) - 1;
        if (!dx && !dy) dx = 1;
        s.forceCommand(Command.WALK, 20, dx, dy);
      }
      return true;
    }
    case 2:
      w.invisibilityLeft += 20 + rng.random(20) * s.level; // cloak
      return true;
    case 3:
      return w.shifterDown ? charm(w) : taunt(w);
    default: {
      // Poison cloud.
      if (w.busy) return false;
      const cloud = world.addOb(Order.FX, F.CLOUD);
      w.busy += 5;
      cloud.ignore = true;
      cloud.lifetime = 40 + 3 * s.level;
      cloud.centerOn(w);
      cloud.invisibilityLeft = 10;
      cloud.aniType = Ani.SPIN;
      cloud.teamNum = w.teamNum;
      cloud.stats.level = s.level;
      cloud.damage = s.level;
      cloud.owner = w;
      return true;
    }
  }
}

/** Taunt: draw enemies to us. */
function taunt(w: Walker): boolean {
  const world = w.world;
  const rng = world.rng;
  if (w.busy) return false;
  for (const foe of world.findFoesInRange(80 + 4 * w.stats.level, w)) {
    if (rng.random(w.stats.level) < rng.random(foe.stats.level)) continue;
    foe.foe = w;
    foe.leader = w;
    if (foe.actType !== Act.CONTROL) foe.stats.forceCommand(Command.FOLLOW, 10 + rng.random(w.stats.level), 0, 0);
  }
  world.notify(`${w.myguy?.name || w.stats.name || 'THIEF'}: 'Nyah Nyah!'`, w);
  w.busy += 2;
  return true;
}

/** Charm: turn one nearby enemy to our side for a while (or anger it). */
function charm(w: Walker): boolean {
  const world = w.world;
  if (w.busy) return false;
  const target = world.findFoesInRange(16 + 4 * w.stats.level, w).find((o) => o.realTeamNum === 255 && o.order === Order.LIVING);
  if (!target) return false;
  const edge = w.stats.level - target.stats.level;
  let failed = false;
  if (edge < 0 || !world.rng.random(20)) {
    target.foe = w;
    target.attack(w);
    failed = true;
  } else {
    target.realTeamNum = target.teamNum;
    target.teamNum = w.teamNum;
    target.foe = w.foe === target ? null : w.foe;
    target.charmLeft = 75 + edge * 25;
  }
  const name = displayName(w, 'Thief');
  world.notify(failed ? `${name} failed to charm!` : `${name} charmed an opponent!`, w);
  w.busy += 10;
  return true;
}

function elf(w: Walker): boolean {
  const s = w.stats;
  // Rocks / bouncing rocks / lots of rocks / mega rocks: more, further-flying rocks.
  const [count, rangeMul, rangeDiv, bounce] =
    w.currentSpecial === 1 ? [2, 1, 1, false] : w.currentSpecial === 2 ? [2, 3, 2, true] : w.currentSpecial === 3 ? [3, 2, 1, true] : [4, 5, 2, true];
  s.magicpoints += (count + (w.currentSpecial === 1 ? 0 : 1)) * s.weaponCost;
  for (let i = 0; i < count; i++) {
    const rock = w.fire();
    if (!rock) return w.currentSpecial === 1;
    rock.lineofsight = idiv(rock.lineofsight * rangeMul, rangeDiv);
    if (bounce && 'doBounce' in rock) rock.doBounce = true;
  }
  return true;
}

function druid(w: Walker): boolean {
  const world = w.world;
  const s = w.stats;
  switch (w.currentSpecial) {
    case 1: {
      // Grow a tree where our shot lands.
      if (w.busy) return false;
      s.magicpoints += s.weaponCost;
      const shot = w.fire();
      if (!shot) return false;
      w.busy += w.fireFrequency * 2;
      const tree = world.addOb(Order.WEAPON, W.TREE);
      tree.setxy(shot.xpos, shot.ypos);
      tree.teamNum = w.teamNum;
      tree.aniType = Ani.GROW;
      tree.owner = w;
      shot.dead = true;
      return true;
    }
    case 2: {
      if (w.busy) return false;
      s.magicpoints += s.weaponCost;
      const shot = w.fire();
      if (!shot) return false;
      const faerie = world.addOb(Order.LIVING, L.FAERIE);
      faerie.setxy(shot.xpos, shot.ypos);
      faerie.teamNum = w.teamNum;
      faerie.owner = w;
      faerie.lifetime = 50 + s.level * 40;
      shot.dead = true;
      if (!world.queryPassable(faerie.xpos, faerie.ypos, faerie)) {
        faerie.dead = true;
        return false;
      }
      w.busy += w.fireFrequency * 3;
      return true;
    }
    case 3:
      // Reveal: see the whole map for a while.
      if (w.busy) return false;
      w.viewAll += s.level * 10;
      w.busy += w.fireFrequency * 4;
      return true;
    default:
      return protect(w);
  }
}

/** Circle of protection round every nearby ally. */
function protect(w: Walker): boolean {
  const world = w.world;
  if (w.busy) return false;
  const friends = world.findFriendsInRange(60, w);
  if (friends.length <= 1) return false;
  let protectedCount = 0;
  for (const friend of friends) {
    if (friend === w) continue;
    // The original looks for an existing circle in the wrong list and never finds one,
    // so every cast adds a fresh circle.
    const circle = world.addOb(Order.WEAPON, W.CIRCLE_PROTECTION);
    circle.owner = friend;
    circle.centerOn(friend);
    circle.teamNum = friend.teamNum;
    circle.stats.level = friend.stats.level;
    if (w.myguy) w.myguy.exp += w.stats.level;
    protectedCount++;
  }
  if (!protectedCount) return false;
  if (onPlayerTeam(w)) world.notify(protectedCount === 1 ? 'Druid protected 1 man!' : `Druid protected ${protectedCount} men!`, w);
  world.sound('heal', w);
  return true;
}

function orc(w: Walker): boolean {
  const world = w.world;
  const s = w.stats;
  const rng = world.rng;
  if (w.currentSpecial === 3) {
    // Bloodlust: a war cry that drives nearby allies (and us) into a frenzy.
    if (w.busy) return false;
    const allies = world.findFriendsInRange(100, w);
    for (const ally of [w, ...allies.filter((a) => a !== w)]) ally.bonusRounds += 15 + 2 * s.level;
    world.sound('roar', w);
    if (onPlayerTeam(w)) world.notify(`${displayName(w, 'Orc')}: BLOODLUST!`, w);
    w.busy += 4;
    return true;
  }
  if (w.currentSpecial === 1) {
    // Howl: enemies freeze in fear.
    if (w.busy) return false;
    w.busy += 2;
    for (const foe of world.findFoesInRange(160 + 20 * s.level, w)) {
      const nerve = foe.myguy ? foe.myguy.constitution : idiv(foe.stats.hitpoints, 30);
      foe.stats.frozenDelay += Math.max(0, 10 + rng.random(s.level * 10) - rng.random(nerve * 10));
    }
    world.sound('roar', w);
    return true;
  }
  // Eat a corpse to heal.
  if (s.hitpoints >= s.maxHitpoints) return false;
  const stain = world.findNearestBlood(w);
  if (!stain || w.distanceToCenter(stain) > 24) return false;
  s.hitpoints = Math.min(s.maxHitpoints, s.hitpoints + stain.stats.level * 5);
  if (w.myguy) w.myguy.exp += stain.stats.level * 5;
  world.notify(`${w.myguy?.name || w.stats.name || 'Orc'} ate a corpse.`, w);
  stain.dead = true;
  stain.death();
  return true;
}

function barbarian(w: Walker): boolean {
  const world = w.world;
  const s = w.stats;
  if (w.currentSpecial < 1 || w.currentSpecial > 4) return true;
  if (w.currentSpecial === 3) {
    // Berserk: a battle rage. Twice as fast for a while, shrugging off some wounds.
    if (w.busy || w.bonusRounds) return false;
    w.bonusRounds += 20 + 3 * s.level;
    s.hitpoints = Math.min(s.maxHitpoints, s.hitpoints + idiv(s.maxHitpoints, 4));
    world.sound('roar', w);
    if (onPlayerTeam(w)) world.notify(`${displayName(w, 'Barbarian')} goes BERSERK!`, w);
    w.busy += 2;
    return true;
  }
  // Hurl a boulder; special 2 makes it explode.
  if (w.busy) return false;
  const shot = w.fire();
  if (!shot) return false;
  const boulder = world.addOb(Order.WEAPON, W.BOULDER);
  boulder.centerOn(shot);
  boulder.owner = w;
  boulder.stats.level = s.level;
  if (w.myguy) {
    boulder.stepsize = idiv(w.myguy.strength, 7);
    boulder.damage += idiv(w.myguy.strength, 5);
  } else {
    boulder.stepsize = s.level * 2;
    boulder.damage += s.level;
  }
  boulder.stepsize = Math.min(15, Math.max(1, boulder.stepsize));
  boulder.lastx = sign(shot.lastx) * boulder.stepsize;
  boulder.lasty = sign(shot.lasty) * boulder.stepsize;
  boulder.skipExit = w.currentSpecial === 2 ? 5000 : 0;
  shot.dead = true;
  w.busy += 1 + w.currentSpecial * 5;
  return true;
}


// --- New skills (not in the original) ---------------------------------------------------

/** Raise the dead: skeletons rise from up to three bloodstains nearby, to fight for us a while. */
function raiseTheDead(w: Walker): boolean {
  const world = w.world;
  const s = w.stats;
  if (w.busy) return false;
  const stains = world.fxlist
    .filter((o) => !o.dead && o.isType(Order.TREASURE, TreasureFamily.STAIN) && w.distanceTo(o) < 100 && world.queryPassable(o.xpos, o.ypos, o))
    .sort((a, b) => w.distanceTo(a) - w.distanceTo(b))
    .slice(0, 3);
  let raised = 0;
  for (const stain of stains) {
    const risen = w.doSummon(L.SKELETON, 150 + s.level * 30);
    if (!risen) break;
    risen.teamNum = w.teamNum;
    risen.stats.level = world.rng.random(s.level) + 1;
    risen.setDifficulty(risen.stats.level);
    risen.setxy(stain.xpos, stain.ypos);
    risen.owner = w;
    stain.dead = true;
    raised++;
  }
  if (!raised) return false;
  if (w.myguy) w.myguy.exp += 20 * raised;
  if (onPlayerTeam(w)) world.notify(`${displayName(w, 'Skeleton')} raised ${raised} dead!`, w);
  w.busy += 10;
  return true;
}

function fireElemental(w: Walker): boolean {
  const world = w.world;
  const s = w.stats;
  switch (w.currentSpecial) {
    case 2: {
      // Immolate: burst into flame, scorching everyone right next to us.
      if (w.busy) return false;
      const foes = world.findFoesInRange(40, w);
      if (!foes.length) return false;
      for (const foe of foes) blastOn(w, foe, (s.level + 1) * 10);
      world.sound('explode', w);
      w.busy += 6;
      return true;
    }
    case 3: {
      // Meteor shower: meteors fall on foes all around.
      if (w.busy) return false;
      const foes = world.findFoesInRange(200, w).slice(0, 3 + idiv(s.level, 3));
      if (!foes.length) return false;
      for (const foe of foes) blastOn(w, foe, (s.level + 2) * 12);
      if (w.myguy) w.myguy.totalShots += foes.length;
      world.sound('explode', w);
      w.busy += 12;
      return true;
    }
    default:
      // Starburst: a fireball in every direction.
      s.magicpoints += 8 * s.weaponCost;
      fireAllDirections(w);
      return true;
  }
}

/** Slimes: acid spray (blobs in every direction), or an acid pool (a poison cloud). */
function slimeAcid(w: Walker): boolean {
  const world = w.world;
  const s = w.stats;
  if (w.busy) return false;
  if (!world.findFoesInRange(100, w).length) return false;
  if (w.currentSpecial === 2) {
    fireAllDirections(w);
    w.busy += 4;
    return true;
  }
  const pool = world.addOb(Order.FX, F.CLOUD);
  pool.ignore = true;
  pool.lifetime = 40 + 3 * s.level;
  pool.centerOn(w);
  pool.invisibilityLeft = 10;
  pool.aniType = Ani.SPIN;
  pool.teamNum = w.teamNum;
  pool.stats.level = s.level;
  pool.damage = s.level + 1;
  pool.owner = w;
  w.busy += 6;
  return true;
}

function faerie(w: Walker): boolean {
  const world = w.world;
  const s = w.stats;
  const rng = world.rng;
  if (w.busy) return false;
  switch (w.currentSpecial) {
    case 1: {
      // Mend: heal the most hurt ally nearby.
      const hurt = world
        .findFriendsInRange(80, w)
        .filter((f) => f !== w && f.order === Order.LIVING && f.stats.hitpoints < f.stats.maxHitpoints)
        .sort((a, b) => a.stats.hitpoints * b.stats.maxHitpoints - b.stats.hitpoints * a.stats.maxHitpoints)[0];
      if (!hurt) return false;
      hurt.stats.hitpoints = Math.min(hurt.stats.maxHitpoints, hurt.stats.hitpoints + 10 + 8 * s.level);
      if (w.myguy) w.myguy.exp += 5 + s.level;
      world.sound('heal', w);
      w.busy += 6;
      return true;
    }
    case 2: {
      // Sleep dust: enemies close by nod off for a while.
      const foes = world.findFoesInRange(48 + 4 * s.level, w).filter((f) => f.order === Order.LIVING);
      if (!foes.length) return false;
      for (const foe of foes) {
        const nerve = foe.myguy ? idiv(foe.myguy.constitution, 2) : foe.stats.level;
        foe.stats.frozenDelay += Math.max(0, 15 + 4 * s.level - rng.random(nerve * 2 + 1));
      }
      world.sound('sparkle', w);
      if (onPlayerTeam(w)) world.notify(`${displayName(w, 'Faerie')} cast Sleep Dust!`, w);
      w.busy += 8;
      return true;
    }
    default: {
      // Glamour: nearby allies (and we) fade from sight.
      const allies = world.findFriendsInRange(80, w).filter((f) => f.order === Order.LIVING);
      for (const ally of allies.includes(w) ? allies : [w, ...allies]) ally.invisibilityLeft += 30 + 8 * s.level;
      world.sound('sparkle', w);
      if (onPlayerTeam(w)) world.notify(`${displayName(w, 'Faerie')} cast Glamour!`, w);
      w.busy += 10;
      return true;
    }
  }
}

/** Life drain: steal life from the nearest enemy close by. */
function lifeDrain(w: Walker): boolean {
  const world = w.world;
  const s = w.stats;
  if (w.busy) return false;
  const foes = world.findFoesInRange(64, w).filter((f) => f.order === Order.LIVING);
  if (!foes.length) return false;
  const victim = foes.reduce((best, foe) => (w.distanceToCenter(foe) < w.distanceToCenter(best) ? foe : best));
  const amount = 10 + 6 * s.level;
  blastOn(w, victim, amount);
  s.hitpoints = Math.min(s.maxHitpoints, s.hitpoints + amount);
  if (w.myguy) w.myguy.totalShots++;
  w.busy += 6;
  return true;
}

/** Banshee wail: a scream that hurts and stuns every enemy around. */
function bansheeWail(w: Walker): boolean {
  const world = w.world;
  const s = w.stats;
  if (w.busy) return false;
  const foes = world.findFoesInRange(80 + 8 * s.level, w).filter((f) => f.order === Order.LIVING);
  if (!foes.length) return false;
  for (const foe of foes) {
    blastOn(w, foe, 10 + 6 * s.level);
    foe.stats.frozenDelay += 10 + 2 * s.level;
  }
  world.sound('roar', w);
  if (onPlayerTeam(w)) world.notify(`${displayName(w, 'Ghost')} wails!`, w);
  w.busy += 12;
  return true;
}
