import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScenarioAsset, SpriteIndex } from '../src/data/assets.ts';
import { LivingFamily, Order } from '../src/data/objects.ts';
import { Guy } from '../src/sim/guy.ts';
import { Rng } from '../src/sim/math.ts';
import { NO_INPUT } from '../src/sim/player.ts';
import { spriteInfoFromBundle } from '../src/sim/spriteInfo.ts';
import { World } from '../src/sim/world.ts';

const assets = join(import.meta.dirname, '../public/assets');
const read = <T>(file: string): T => JSON.parse(readFileSync(join(assets, file), 'utf8')) as T;
const spriteInfo = spriteInfoFromBundle(read<SpriteIndex>('sprites.json'), new Uint8Array(readFileSync(join(assets, 'sprites.bin'))));

function squad(...families: number[]): Guy[] {
  return families.map((f) => new Guy(f));
}

function makeWorld(id: string, seed = 7, guys = squad(LivingFamily.SOLDIER, LivingFamily.ARCHER, LivingFamily.MAGE)): World {
  const s = read<ScenarioAsset>(`scenarios/${id}.json`);
  return new World({ map: s.map, objects: s.objects, scenarioType: s.type, spriteInfo, seed, squad: guys });
}

function snapshot(world: World): string {
  return [...world.allObjects()].map((o) => `${o.order}/${o.family}@${o.xpos},${o.ypos}:${o.stats.hitpoints}`).join('|');
}

function livingCount(world: World, team: (t: number) => boolean): number {
  return world.oblist.filter((o) => !o.dead && o.order === Order.LIVING && team(o.teamNum)).length;
}

describe('Rng', () => {
  it('matches random(x) semantics', () => {
    const rng = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng.random(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
    expect(rng.random(0)).toBe(0);
    expect(rng.random(-1)).toBeGreaterThanOrEqual(0);
  });
});

describe('World', () => {
  it('places the squad on the team markers and removes the markers', () => {
    const world = makeWorld('scen1');
    expect(world.oblist.some((o) => o.order === Order.SPECIAL)).toBe(false);
    const ours = world.oblist.filter((o) => o.myguy);
    expect(ours).toHaveLength(3);
    for (const unit of ours) expect(unit.xpos).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic for a given seed', () => {
    const a = makeWorld('scen1', 42);
    const b = makeWorld('scen1', 42);
    for (let i = 0; i < 400; i++) {
      a.tick();
      b.tick();
    }
    expect(snapshot(a)).toBe(snapshot(b));
  });

  it('fights a battle: units engage and casualties happen', () => {
    const world = makeWorld('scen1');
    const enemiesAtStart = livingCount(world, (t) => t !== 0);
    let shots = 0;
    for (let i = 0; i < 3000 && !world.outcome; i++) {
      world.tick();
      shots += world.events.filter((e) => e.type === 'sound' && ['fwip', 'bow', 'blast', 'sparkle', 'bolt'].includes(e.sound)).length;
      world.events.length = 0;
    }
    expect(shots).toBeGreaterThan(0);
    const enemiesNow = livingCount(world, (t) => t !== 0);
    const oursNow = livingCount(world, (t) => t === 0);
    expect(enemiesNow < enemiesAtStart || oursNow < 3 || world.outcome !== null).toBe(true);
  });

  it.each(['scen1', 'scen2', 'scen3', 'scen4', 'scen5', 'scen10', 'scen20', 'scen300'])('%s runs 2000 ticks without errors', (id) => {
    const world = makeWorld(id, 3, squad(LivingFamily.SOLDIER, LivingFamily.ELF, LivingFamily.CLERIC, LivingFamily.THIEF));
    for (let i = 0; i < 2000 && !world.outcome; i++) world.tick();
    for (const ob of world.allObjects()) {
      expect(Number.isFinite(ob.xpos) && Number.isFinite(ob.ypos)).toBe(true);
    }
  });

  it('lets the player steer a squad member', () => {
    const world = makeWorld('scen1');
    const control = world.players[0].control!;
    expect(control.myguy).not.toBeNull();
    expect(control.user).toBe(0);
    const startX = control.xpos;
    const startY = control.ypos;
    for (let i = 0; i < 20; i++) world.tick([{ ...NO_INPUT, moveX: 0, moveY: -1 }]);
    expect(Math.abs(control.xpos - startX) + Math.abs(control.ypos - startY)).toBeGreaterThan(0);
  });

  it('starts in control of the squad leader', () => {
    const guys = squad(LivingFamily.SOLDIER, LivingFamily.ARCHER, LivingFamily.MAGE);
    guys[1].leader = true;
    const world = makeWorld('scen1', 7, guys);
    expect(world.players[0].control!.myguy).toBe(guys[1]);
  });

  it('switches to another squad member', () => {
    const world = makeWorld('scen1');
    const first = world.players[0].control!;
    world.tick([{ ...NO_INPUT, switchUnit: true }]);
    const second = world.players[0].control!;
    expect(second).not.toBe(first);
    expect(first.user).toBe(-1);
    expect(second.user).toBe(0);
  });
});
