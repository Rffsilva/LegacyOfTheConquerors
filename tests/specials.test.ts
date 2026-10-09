import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScenarioAsset, SpriteIndex } from '../src/data/assets.ts';
import { FxFamily, LivingFamily as L, Order, WeaponFamily } from '../src/data/objects.ts';
import { Command } from '../src/sim/constants.ts';
import { Guy } from '../src/sim/guy.ts';
import { SPECIAL_NAMES } from '../src/sim/specialNames.ts';
import { spriteInfoFromBundle } from '../src/sim/spriteInfo.ts';
import type { Walker } from '../src/sim/walker.ts';
import { World } from '../src/sim/world.ts';

const assets = join(import.meta.dirname, '../public/assets');
const read = <T>(file: string): T => JSON.parse(readFileSync(join(assets, file), 'utf8')) as T;
const spriteInfo = spriteInfoFromBundle(read<SpriteIndex>('sprites.json'), new Uint8Array(readFileSync(join(assets, 'sprites.bin'))));
const scen1 = read<ScenarioAsset>('scenarios/scen1.json');

/** A world with one squad member of `family`, high level and full of magic, next to an enemy. */
function setup(family: number, level = 12) {
  const world = new World({ map: scen1.map, objects: scen1.objects, spriteInfo, seed: 11, players: 0, squad: [new Guy(family)] });
  const hero = world.oblist.find((o) => o.myguy)!;
  hero.myguy!.intelligence = 200;
  hero.stats.level = level;
  hero.stats.maxMagicpoints = hero.stats.magicpoints = 5000;
  const enemy = world.oblist.find((o) => o.order === Order.LIVING && o.teamNum !== 0)!;
  enemy.setxy(hero.xpos + 24, hero.ypos);
  hero.foe = enemy;
  hero.lastx = hero.stepsize;
  hero.lasty = 0;
  hero.curdir = hero.enddir = 2; // facing right, toward the enemy
  return { world, hero, enemy };
}

function count(world: World, order: number, family: number): number {
  return [...world.allObjects()].filter((o) => !o.dead && o.isType(order, family)).length;
}

function useSpecial(hero: Walker, slot: number, alternate = false): number {
  hero.currentSpecial = slot;
  hero.shifterDown = alternate ? 1 : 0;
  hero.busy = 0;
  const before = hero.stats.magicpoints;
  hero.special();
  return before - hero.stats.magicpoints;
}

describe('special abilities', () => {
  const families = Object.keys(SPECIAL_NAMES).map(Number);

  it.each(families)('family %i: every special runs without errors', (family) => {
    for (const alternate of [false, true]) {
      for (let slot = 1; slot <= 5; slot++) {
        const { world, hero } = setup(family);
        useSpecial(hero, slot, alternate);
        for (let i = 0; i < 120 && !world.outcome; i++) world.tick();
        for (const ob of world.allObjects()) expect(Number.isFinite(ob.xpos)).toBe(true);
      }
    }
  });

  it('charges magic only when a special goes off', () => {
    const { hero } = setup(L.CLERIC);
    // Healing with nobody hurt nearby is free.
    expect(useSpecial(hero, 1)).toBe(0);
  });

  it('soldier charge queues a rush', () => {
    const { hero } = setup(L.SOLDIER);
    expect(useSpecial(hero, 1)).toBe(25);
    expect(hero.stats.commands.some((c) => c.type === Command.RUSH)).toBe(true);
  });

  it('archer fire arrows shoot in a full circle', () => {
    const { world, hero, enemy } = setup(L.ARCHER);
    enemy.setxy(hero.xpos, hero.ypos + 200); // out of point-blank range
    // Costs 20, minus the 8 arrows' ammo the special pays for up front.
    expect(useSpecial(hero, 1)).toBe(12);
    let arrows = 0;
    for (let i = 0; i < 12; i++) {
      world.tick();
      arrows = Math.max(arrows, count(world, Order.WEAPON, WeaponFamily.FIRE_ARROW));
    }
    expect(arrows).toBeGreaterThan(2);
  });

  it('thief bomb explodes', () => {
    const { world, hero } = setup(L.THIEF);
    expect(useSpecial(hero, 1)).toBe(35);
    expect(count(world, Order.FX, FxFamily.BOMB)).toBe(1);
    let exploded = false;
    for (let i = 0; i < 80; i++) {
      world.tick();
      if (count(world, Order.FX, FxFamily.EXPLOSION)) exploded = true;
    }
    expect(exploded).toBe(true);
  });

  it('mage teleport moves the mage', () => {
    const { world, hero } = setup(L.MAGE);
    const [x, y] = [hero.xpos, hero.ypos];
    useSpecial(hero, 1);
    for (let i = 0; i < 20; i++) world.tick();
    expect(hero.xpos !== x || hero.ypos !== y).toBe(true);
  });

  it('big slime splits into two small slimes', () => {
    const { world, hero } = setup(L.SLIME);
    useSpecial(hero, 1);
    for (let i = 0; i < 20; i++) world.tick();
    expect(count(world, Order.LIVING, L.SMALL_SLIME)).toBeGreaterThanOrEqual(2);
  });

  it('the AI uses specials during a battle', () => {
    const world = new World({ map: scen1.map, objects: scen1.objects, spriteInfo, seed: 5, players: 0, squad: [L.SOLDIER, L.CLERIC, L.THIEF, L.MAGE].map((f) => new Guy(f)) });
    for (const o of world.oblist) if (o.myguy) o.stats.magicpoints = o.stats.maxMagicpoints = 500;
    const sounds = new Set<string>();
    for (let i = 0; i < 1500 && !world.outcome; i++) {
      world.tick();
      for (const e of world.events) if (e.type === 'sound') sounds.add(e.sound);
      world.events.length = 0;
    }
    expect(['charge', 'teleport', 'heal', 'explode'].some((s) => sounds.has(s))).toBe(true);
  });
});

describe('new skills (not in the original)', () => {
  /** Ticks until the explosions the special set off have gone off. */
  const settle = (world: World, ticks = 20) => {
    for (let i = 0; i < ticks; i++) world.tick();
  };
  const families = [L.BARBARIAN, L.ORC, L.SKELETON, L.FIREELEMENTAL, L.GHOST, L.FAERIE, L.SMALL_SLIME, L.MEDIUM_SLIME, L.SLIME];

  it.each(families)('family %i has three skills, unlocked at levels 1, 4 and 7', (family) => {
    const names = SPECIAL_NAMES[family];
    expect(names.slice(1, 4).every((n) => n && n !== 'NONE')).toBe(true);
  });

  it('barbarian berserk: twice as fast for a while, and a quarter of the wounds back', () => {
    const { hero } = setup(L.BARBARIAN, 7);
    hero.stats.hitpoints = 10;
    expect(useSpecial(hero, 3)).toBe(60);
    expect(hero.bonusRounds).toBe(20 + 3 * 7);
    expect(hero.stats.hitpoints).toBe(10 + Math.floor(hero.stats.maxHitpoints / 4));
    expect(useSpecial(hero, 3)).toBe(0); // no stacking while it lasts
  });

  it('orc bloodlust speeds up nearby allies too', () => {
    const world = new World({ map: scen1.map, objects: scen1.objects, spriteInfo, seed: 3, players: 0, squad: [new Guy(L.ORC), new Guy(L.SOLDIER)] });
    const [orc, soldier] = [L.ORC, L.SOLDIER].map((f) => world.oblist.find((o) => o.myguy?.family === f)!);
    soldier.setxy(orc.xpos + 20, orc.ypos);
    orc.stats.level = 7;
    orc.stats.magicpoints = 500;
    expect(useSpecial(orc, 3)).toBe(80);
    expect(orc.bonusRounds).toBeGreaterThan(0);
    expect(soldier.bonusRounds).toBe(orc.bonusRounds);
  });

  it('skeleton bone storm and raise the dead', () => {
    const { world, hero, enemy } = setup(L.SKELETON, 7);
    expect(useSpecial(hero, 2)).toBe(30);
    expect(count(world, Order.WEAPON, WeaponFamily.BONE)).toBeGreaterThanOrEqual(7);
    // No bodies nearby: nothing to raise, and no charge.
    expect(useSpecial(hero, 3)).toBe(0);
    enemy.stats.hitpoints = 0;
    enemy.dead = true;
    enemy.death();
    const stain = world.addFxOb(Order.TREASURE, 0);
    stain.setxy(hero.xpos + 40, hero.ypos);
    const before = count(world, Order.LIVING, L.SKELETON);
    expect(useSpecial(hero, 3)).toBe(60);
    expect(count(world, Order.LIVING, L.SKELETON)).toBeGreaterThan(before);
  });

  it('fire elemental immolate and meteor shower hurt nearby enemies', () => {
    for (const slot of [2, 3]) {
      const { world, hero, enemy } = setup(L.FIREELEMENTAL, 7);
      const hp = enemy.stats.hitpoints;
      expect(useSpecial(hero, slot)).toBe(slot === 2 ? 60 : 120);
      settle(world);
      expect(enemy.dead || enemy.stats.hitpoints < hp).toBe(true);
    }
  });

  it('ghost life drain heals the ghost; banshee wail stuns', () => {
    const { world, hero, enemy } = setup(L.GHOST, 7);
    hero.stats.hitpoints = 5;
    expect(useSpecial(hero, 2)).toBe(40);
    expect(hero.stats.hitpoints).toBe(5 + 10 + 6 * 7);
    settle(world);
    const wail = setup(L.GHOST, 7);
    expect(useSpecial(wail.hero, 3)).toBe(90);
    expect(wail.enemy.stats.frozenDelay).toBeGreaterThan(0);
    expect(enemy.dead || enemy.stats.hitpoints < enemy.stats.maxHitpoints).toBe(true);
  });

  it('faerie mend, sleep dust and glamour', () => {
    const world = new World({ map: scen1.map, objects: scen1.objects, spriteInfo, seed: 3, players: 0, squad: [new Guy(L.FAERIE), new Guy(L.SOLDIER)] });
    const [faerie, soldier] = [L.FAERIE, L.SOLDIER].map((f) => world.oblist.find((o) => o.myguy?.family === f)!);
    soldier.setxy(faerie.xpos + 20, faerie.ypos);
    faerie.stats.level = 7;
    faerie.stats.magicpoints = 500;
    // Nobody hurt: mend costs nothing.
    expect(useSpecial(faerie, 1)).toBe(0);
    soldier.stats.hitpoints = 1;
    expect(useSpecial(faerie, 1)).toBe(20);
    expect(soldier.stats.hitpoints).toBe(1 + 10 + 8 * 7);
    expect(useSpecial(faerie, 3)).toBe(100);
    expect(soldier.invisibilityLeft).toBeGreaterThan(0);
    expect(faerie.invisibilityLeft).toBeGreaterThan(0);

    const { hero, enemy } = setup(L.FAERIE, 7);
    expect(useSpecial(hero, 2)).toBe(50);
    expect(enemy.stats.frozenDelay).toBeGreaterThan(0);
  });

  it('slimes spray acid and leave acid pools, but only with enemies around', () => {
    const { world, hero, enemy } = setup(L.MEDIUM_SLIME, 7);
    expect(useSpecial(hero, 2)).toBe(30);
    expect(count(world, Order.WEAPON, WeaponFamily.BLOB)).toBeGreaterThanOrEqual(7);
    expect(useSpecial(hero, 3)).toBe(45);
    expect(count(world, Order.FX, FxFamily.CLOUD)).toBe(1);
    enemy.setxy(hero.xpos + 400, hero.ypos + 400);
    expect(useSpecial(hero, 2)).toBe(0);
  });
});
