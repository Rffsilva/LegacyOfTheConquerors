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
