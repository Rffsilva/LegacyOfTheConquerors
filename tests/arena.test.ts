import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SpriteIndex } from '../src/data/assets.ts';
import { LivingFamily as L, Order, SpecialFamily } from '../src/data/objects.ts';
import { GRID_SIZE } from '../src/data/tiles.ts';
import { ARENA_FIELD, ArenaRules, arenaScenario, CHECKPOINT, waveSize } from '../src/game/arena.ts';
import { applyBattleSummary, arenaBonus, newCampaign, type Campaign } from '../src/game/campaign.ts';
import { applyBattleResults, chooseField, newLobby, nextFrame, settleArenaRun, startBattle, type ServerBattle } from '../src/online/battle.ts';
import { Lockstep, type FieldOptions, type Frame } from '../src/online/lockstep.ts';
import { createRoom, joinRoom, memberView, toData, type RoomState } from '../src/online/room.ts';
import { Guy } from '../src/sim/guy.ts';
import { spriteInfoFromBundle } from '../src/sim/spriteInfo.ts';
import { TileClass, tileClass } from '../src/sim/terrain.ts';
import { World } from '../src/sim/world.ts';

const assets = join(import.meta.dirname, '../public/assets');
const spriteInfo = spriteInfoFromBundle(
  JSON.parse(readFileSync(join(assets, 'sprites.json'), 'utf8')) as SpriteIndex,
  new Uint8Array(readFileSync(join(assets, 'sprites.bin'))),
);
const field = arenaScenario();
const fieldOptions: FieldOptions = { map: field.map, objects: field.objects, scenarioType: field.type, spriteInfo };

/** A seasoned squad member, strong enough to see a few rounds through. */
function veteran(family: number, level = 10): Guy {
  const guy = new Guy(family);
  guy.name = `${guy.name}${level}`;
  guy.level = level;
  guy.strength += level * 5;
  guy.constitution += level * 5;
  guy.dexterity += level * 2;
  guy.armor += level;
  return guy;
}

const SQUAD = [L.BARBARIAN, L.SOLDIER, L.ARCHER, L.CLERIC, L.MAGE, L.ELF];

function arena(squad: Guy[]) {
  const rules = new ArenaRules();
  const world = new World({ ...fieldOptions, seed: 11, squad, rules });
  return { world, rules };
}

/** Ticks until `done`, failing if it takes too long. */
function until(world: World, done: () => boolean, limit = 20_000): void {
  for (let i = 0; i < limit && !done(); i++) world.tick();
  expect(done()).toBe(true);
}

function campaignWith(squad: Guy[]): Campaign {
  const campaign = newCampaign();
  campaign.team = squad.map((g) => g.clone());
  campaign.scenario = 4;
  campaign.completed = [1, 2, 3];
  return campaign;
}

describe('the arena field', () => {
  it('is walled in, with room for two full squads in the middle and open gates', () => {
    const { width, height, tiles } = field.map;
    expect([width, height]).toEqual([40, 40]);
    const at = (x: number, y: number) => tiles[y * width + x];
    for (let i = 0; i < width; i++) {
      expect(tileClass(at(i, 0))).not.toBe(TileClass.OPEN);
      expect(tileClass(at(i, height - 1))).not.toBe(TileClass.OPEN);
      expect(tileClass(at(0, i))).not.toBe(TileClass.OPEN);
      expect(tileClass(at(width - 1, i))).not.toBe(TileClass.OPEN);
    }
    const markers = field.objects.filter((o) => o.order === Order.SPECIAL && o.family === SpecialFamily.RESERVED_TEAM);
    expect(markers.length).toBeGreaterThanOrEqual(48);
    for (const m of markers) expect(tileClass(at(m.x / GRID_SIZE, m.y / GRID_SIZE))).toBe(TileClass.OPEN);
  });

  it('sends more foes each round, more of them for more players, and stronger ones later', () => {
    expect(waveSize(1, 1).count).toBeLessThan(waveSize(5, 1).count);
    expect(waveSize(5, 1).count).toBeLessThan(waveSize(10, 1).count);
    expect(waveSize(10, 2).count).toBeGreaterThan(waveSize(10, 1).count);
    expect(waveSize(1, 1).level).toBe(1);
    expect(waveSize(CHECKPOINT + 1, 1).level).toBe(2);
    expect(waveSize(1000, 4).count).toBeLessThanOrEqual(48);
  });
});

describe('an arena run', () => {
  it('fights rounds until a checkpoint, then waits for the choice; leaving banks the rewards', () => {
    const squad = SQUAD.map((f) => veteran(f));
    const campaign = campaignWith(squad);
    const expBefore = campaign.team.reduce((n, g) => n + g.exp, 0);
    const { world, rules } = arena(squad);
    until(world, () => rules.phase === 'checkpoint');
    expect(rules.round).toBe(CHECKPOINT);
    expect(rules.cleared).toBe(CHECKPOINT);
    // A single player can take their time: no new foes while the choice waits.
    for (let i = 0; i < 2000; i++) world.tick();
    expect(rules.phase).toBe('checkpoint');
    expect(world.remainingFoes(0)).toBe(0);
    expect(world.outcome).toBeNull();

    rules.choose(world, 0, true);
    expect(world.outcome).toEqual({ result: 'victory' });
    const summary = rules.summary(world, 0)!;
    expect(summary.arena).toBe(CHECKPOINT);
    expect(summary.survivors.length).toBeGreaterThan(0);

    // The rewards: score, the rounds bonus, experience; the campaign's own fields don't move.
    const money = campaign.money;
    const report = applyBattleSummary(campaign, summary, squad, 1);
    expect(report.arena).toEqual({ rounds: CHECKPOINT, bonus: arenaBonus(CHECKPOINT) });
    expect(report.cash).toBe(summary.score * 2 + arenaBonus(CHECKPOINT));
    expect(campaign.money).toBe(money + report.cash);
    expect(campaign.scenario).toBe(4);
    expect(campaign.completed).toEqual([1, 2, 3]);
    expect(campaign.team.reduce((n, g) => n + g.exp, 0)).toBeGreaterThan(expBefore);
  });

  it('fights on after choosing to, with the squad rested', () => {
    const { world, rules } = arena(SQUAD.map((f) => veteran(f)));
    until(world, () => rules.phase === 'checkpoint');
    const ours = world.oblist.filter((o) => !o.dead && o.order === Order.LIVING && o.squad === 0);
    expect(ours.every((o) => o.stats.hitpoints === o.stats.maxHitpoints)).toBe(true);
    rules.choose(world, 0, false);
    expect(rules.phase).toBe('break');
    until(world, () => rules.round === CHECKPOINT + 1);
    expect(world.remainingFoes(0)).toBe(waveSize(CHECKPOINT + 1, 1).count);
  });

  it('earns nothing when the squad falls before leaving', () => {
    const squad = [new Guy(L.SOLDIER)];
    const { world, rules } = arena(squad);
    until(world, () => world.outcome !== null);
    expect(world.outcome?.result).toBe('defeat');
    const summary = rules.summary(world, 0)!;
    const campaign = campaignWith(squad);
    const before = JSON.stringify(campaign);
    const report = applyBattleSummary(campaign, summary, squad, 1);
    expect(report.outcome.result).toBe('defeat');
    expect(report.cash).toBe(0);
    expect(JSON.stringify(campaign)).toBe(before);
  });
});

describe('the online arena', () => {
  const A = 'a'.repeat(32);
  const B = 'b'.repeat(32);

  function room(): RoomState {
    const state = createRoom({ id: 'f'.repeat(64), name: 'Co-op', difficulty: 1, invite: 'i'.repeat(24), owner: A, ownerName: 'Ricardo', now: 1 });
    joinRoom(state, B, 'Irmão', 'i'.repeat(24), 2);
    state.members[A].campaign.team = SQUAD.slice(0, 3).map((f) => toData(veteran(f)));
    state.members[B].campaign.team = SQUAD.slice(3).map((f) => toData(veteran(f)));
    return state;
  }

  /** Plays the server's clock until the replica says `done`, returning the frames. */
  function playUntil(battle: ServerBattle, replica: Lockstep, done: () => boolean, limit = 20_000): Frame[] {
    const frames: Frame[] = [];
    for (let i = 0; i < limit && !done(); i++) {
      const frame = nextFrame(battle);
      frames.push(frame);
      replica.play(frame);
    }
    expect(done()).toBe(true);
    return frames;
  }

  it('lets each player choose for themselves, settles a leaver at once, and plays the same everywhere', () => {
    const state = room();
    const lobby = newLobby(state);
    expect(chooseField(state, lobby, ARENA_FIELD)).toBeNull();
    const battle = startBattle(state, lobby, [A, B], 'arena-1', 77);
    const one = new Lockstep(battle.setup, fieldOptions);
    const arenaOf = (l: Lockstep) => l.world.rules as ArenaRules;
    const frames = playUntil(battle, one, () => arenaOf(one).phase === 'checkpoint');

    // Ricardo leaves with his rewards; his brother fights on.
    battle.pending.push({ t: 'choice', player: 0, leave: true }, { t: 'choice', player: 1, leave: false });
    frames.push(...playUntil(battle, one, () => arenaOf(one).round === CHECKPOINT + 1));
    const rules = arenaOf(one);
    expect(rules.standing(0)).toBe('banked');
    expect(rules.standing(1)).toBe('fighting');
    expect(one.world.oblist.some((o) => !o.dead && o.squad === 0)).toBe(false);
    expect(one.world.outcome).toBeNull();

    // Another device that replays the same frames sees exactly the same arena.
    const two = new Lockstep(battle.setup, fieldOptions);
    for (const frame of frames) two.play(frame);
    expect(arenaOf(two).banked[0]).toEqual(rules.banked[0]);
    expect(two.world.oblist.map((o) => `${o.family}@${o.xpos},${o.ypos}:${o.stats.hitpoints}`)).toEqual(
      one.world.oblist.map((o) => `${o.family}@${o.xpos},${o.ypos}:${o.stats.hitpoints}`),
    );

    // The server settles Ricardo's run once, straight away.
    const money = memberView(state, A).money;
    const report = settleArenaRun(state, battle, 0, 1, rules.summary(one.world, 0));
    expect(report?.arena?.rounds).toBe(CHECKPOINT);
    expect(memberView(state, A).money).toBe(money + report!.cash);
    expect(memberView(state, A).scenario).toBe(1); // the campaign's own fields are untouched
    expect(settleArenaRun(state, battle, 0, 1, rules.summary(one.world, 0))).toBeNull();
    // ...and the battle's final results leave it alone.
    const after = memberView(state, A).money;
    applyBattleResults(state, battle, 1, [rules.summary(one.world, 0), rules.summary(one.world, 1)]);
    expect(memberView(state, A).money).toBe(after);
  });

  it('gives undecided players 30 seconds, then they leave with their rewards', () => {
    const state = room();
    const lobby = newLobby(state);
    chooseField(state, lobby, ARENA_FIELD);
    const battle = startBattle(state, lobby, [A, B], 'arena-2', 78);
    const one = new Lockstep(battle.setup, fieldOptions);
    const rules = one.world.rules as ArenaRules;
    playUntil(battle, one, () => rules.phase === 'checkpoint');
    battle.pending.push({ t: 'choice', player: 1, leave: false });
    playUntil(battle, one, () => rules.phase !== 'checkpoint', Math.ceil(30_000 / battle.setup.tickMs) + 5);
    expect(rules.standing(0)).toBe('banked');
    expect(rules.standing(1)).toBe('fighting');
  });
});
