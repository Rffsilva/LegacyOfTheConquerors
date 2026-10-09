import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScenarioAsset, SpriteIndex } from '../src/data/assets.ts';
import { LivingFamily as L, Order, TreasureFamily } from '../src/data/objects.ts';
import {
  applyBattle,
  deserialize,
  dismiss,
  hire,
  hireCost,
  leaderIndex,
  MAX_TEAM,
  newCampaign,
  recruit,
  serialize,
  setLeader,
  squadFor,
  train,
  trainingCost,
} from '../src/game/campaign.ts';
import { calculateExp } from '../src/sim/guy.ts';
import { spriteInfoFromBundle } from '../src/sim/spriteInfo.ts';
import { World } from '../src/sim/world.ts';

const assets = join(import.meta.dirname, '../public/assets');
const read = <T>(file: string): T => JSON.parse(readFileSync(join(assets, file), 'utf8')) as T;
const spriteInfo = spriteInfoFromBundle(read<SpriteIndex>('sprites.json'), new Uint8Array(readFileSync(join(assets, 'sprites.bin'))));
const scen1 = read<ScenarioAsset>('scenarios/scen1.json');

describe('costs', () => {
  it('prices a base recruit at the family cost', () => {
    const c = newCampaign();
    expect(hireCost(recruit(c, L.SOLDIER))).toBe(250);
    expect(hireCost(recruit(c, L.ELF))).toBe(150);
  });

  it('charges (points above base)^1.85 x the family stat price', () => {
    const c = newCampaign();
    const soldier = recruit(c, L.SOLDIER);
    soldier.strength += 2; // 2^1.85 * 6 = 21.56
    expect(hireCost(soldier)).toBe(250 + 21);
  });

  it('includes experience for higher starting levels', () => {
    const soldier = recruit(newCampaign(), L.SOLDIER);
    soldier.level = 2; // 1^1.85 * 200 + 8000 exp
    expect(hireCost(soldier)).toBe(250 + 200 + 8000);
  });

  it('only charges training for improvements beyond earned experience', () => {
    const c = newCampaign();
    const guy = recruit(c, L.ARCHER);
    hire(c, guy);
    guy.exp = calculateExp(2) + 100; // already earned level 2
    const proposal = guy.clone();
    proposal.level = 2;
    expect(trainingCost(guy, proposal)).toBe(200); // just the level's stat price
    proposal.level = 3;
    expect(trainingCost(guy, proposal)).toBeGreaterThan(200);
  });
});

describe('team management', () => {
  it('hires within budget and names recruits like the original', () => {
    const c = newCampaign();
    const first = recruit(c, L.SOLDIER);
    expect(first.name).toBe('SOLDIER1');
    expect(hire(c, first)).toEqual({ ok: true });
    expect(c.money).toBe(5000 - 250);
    expect(recruit(c, L.SOLDIER).name).toBe('SOLDIER2');
  });

  it('refuses when broke or full', () => {
    const c = newCampaign();
    c.money = 100;
    expect(hire(c, recruit(c, L.SOLDIER)).ok).toBe(false);
    c.money = 1e9;
    for (let i = 0; i < MAX_TEAM; i++) hire(c, recruit(c, L.ELF));
    expect(hire(c, recruit(c, L.ELF)).ok).toBe(false);
  });

  it('trains stats up and never down', () => {
    const c = newCampaign();
    hire(c, recruit(c, L.SOLDIER));
    const proposal = c.team[0].clone();
    proposal.strength += 3;
    proposal.dexterity -= 3;
    const before = c.money;
    expect(train(c, 0, proposal).ok).toBe(true);
    expect(c.team[0].strength).toBe(15);
    expect(c.team[0].dexterity).toBe(6);
    expect(c.money).toBeLessThan(before);
  });

  it('keeps one leader, falling back to the first member', () => {
    const c = newCampaign();
    c.money = 1e9;
    for (let i = 0; i < 3; i++) hire(c, recruit(c, L.SOLDIER));
    expect(leaderIndex(c)).toBe(0);
    setLeader(c, 2);
    setLeader(c, 1);
    expect(c.team.map((g) => g.leader)).toEqual([false, true, false]);
    expect(deserialize(serialize(c)).team[1].leader).toBe(true);
    dismiss(c, 1);
    expect(leaderIndex(c)).toBe(0);
    expect(squadFor(c).map((g) => g.leader)).toEqual([true, false]);
  });

  it('round-trips through JSON', () => {
    const c = newCampaign('Test');
    hire(c, recruit(c, L.MAGE));
    const copy = deserialize(serialize(c));
    expect(copy.team[0].clone().name).toBe('MAGE1');
    expect(copy.money).toBe(c.money);
  });
});

describe('battles', () => {
  function battle() {
    const c = newCampaign();
    for (const f of [L.SOLDIER, L.ARCHER, L.MAGE]) hire(c, recruit(c, f));
    const squad = squadFor(c);
    const world = new World({ map: scen1.map, objects: scen1.objects, spriteInfo, seed: 3, players: 0, squad });
    return { c, squad, world };
  }

  it('pays out, levels survivors and loses the fallen on victory', () => {
    const { c, squad, world } = battle();
    const archer = world.oblist.find((o) => o.myguy === squad[1])!;
    archer.dead = true; // fell in battle
    squad[0].exp = calculateExp(4); // the soldier earned three levels
    world.score[0] = 1000;
    world.ticks = 1000;
    world.outcome = { result: 'victory', exitTo: 2 };

    const report = applyBattle(c, world, squad, 1);
    expect(report.fallen).toEqual(['ARCHER1']);
    expect(c.team.map((g) => g.name)).toEqual(expect.arrayContaining(['SOLDIER1', 'MAGE1']));
    expect(c.team).toHaveLength(2);
    expect(report.levelUps).toContainEqual({ name: 'SOLDIER1', from: 1, to: 4, newAbility: 'BOOMERANG' });
    expect(report.timeBonus).toBeGreaterThan(0);
    expect(c.money).toBe(5000 - 250 - 350 - 450 + 2000 + report.timeBonus);
    expect(c.completed).toEqual([1]);
    expect(c.scenario).toBe(2);
  });

  it('leaves the team untouched on defeat', () => {
    const { c, squad, world } = battle();
    world.oblist.filter((o) => o.myguy).forEach((o) => (o.dead = true));
    world.outcome = { result: 'defeat', reason: 'YOUR MEN ARE CRUSHED!' };
    const money = c.money;
    applyBattle(c, world, squad, 1);
    expect(c.team).toHaveLength(3);
    expect(c.money).toBe(money);
    expect(c.completed).toEqual([]);
  });

  it('clears enemies from a field that was already won', () => {
    const c = newCampaign();
    hire(c, recruit(c, L.SOLDIER));
    const world = new World({ map: scen1.map, objects: scen1.objects, spriteInfo, seed: 3, squad: squadFor(c), alreadyWon: true });
    expect(world.oblist.filter((o) => o.order === Order.LIVING && o.teamNum !== 0)).toHaveLength(0);
    expect(world.fxlist.some((o) => o.isType(Order.TREASURE, TreasureFamily.EXIT))).toBe(true);
  });
});
