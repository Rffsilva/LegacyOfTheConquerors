import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScenarioAsset, SpriteIndex } from '../src/data/assets.ts';
import { LivingFamily as L } from '../src/data/objects.ts';
import { recruit } from '../src/game/campaign.ts';
import {
  applyBattleResults,
  chooseField,
  joinBattle,
  leaveBattle,
  newLobby,
  nextFrame,
  readyToStart,
  setInput,
  startBattle,
  type ServerBattle,
} from '../src/online/battle.ts';
import { decodeInput, encodeInput, Lockstep, type FieldOptions, type Frame } from '../src/online/lockstep.ts';
import { OnlineBattle } from '../src/online/onlineBattle.ts';
import type { OnlineCampaign } from '../src/online/onlineCampaign.ts';
import type { Whereabouts } from '../src/online/protocol.ts';
import { act, createRoom, joinRoom, memberView, toData, type RoomState } from '../src/online/room.ts';
import { NO_INPUT } from '../src/sim/player.ts';
import { spriteInfoFromBundle } from '../src/sim/spriteInfo.ts';
import type { World } from '../src/sim/world.ts';

const assets = join(import.meta.dirname, '../public/assets');
const read = <T>(file: string): T => JSON.parse(readFileSync(join(assets, file), 'utf8')) as T;
const spriteInfo = spriteInfoFromBundle(read<SpriteIndex>('sprites.json'), new Uint8Array(readFileSync(join(assets, 'sprites.bin'))));

function field(id: string): FieldOptions {
  const s = read<ScenarioAsset>(`scenarios/${id}.json`);
  return { map: s.map, objects: s.objects, scenarioType: s.type, spriteInfo };
}

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const C = 'c'.repeat(32);
const barracks: Whereabouts = { at: 'barracks' };

function room(): RoomState {
  const state = createRoom({ id: 'f'.repeat(64), name: 'Co-op', difficulty: 1, invite: 'i'.repeat(24), owner: A, ownerName: 'Ricardo', now: 1 });
  joinRoom(state, B, 'Irmão', 'i'.repeat(24), 2);
  joinRoom(state, C, 'Late', 'i'.repeat(24), 3);
  for (const [id, families] of [[A, [L.SOLDIER, L.ARCHER]], [B, [L.ELF, L.MAGE]], [C, [L.BARBARIAN]]] as const) {
    for (const family of families) act(state, id, { t: 'hire', guy: toData(recruit(memberView(state, id), family)) });
  }
  return state;
}

function snapshot(world: World): string {
  return [...world.allObjects()].map((o) => `${o.order}/${o.family}/${o.squad}@${o.xpos},${o.ypos}:${o.stats.hitpoints}:${o.user}`).join('|');
}

/** Plays `ticks` ticks on the server, with scripted inputs, returning every frame. */
function run(battle: ServerBattle, ticks: number, script: (n: number) => void): Frame[] {
  const frames: Frame[] = [];
  for (let i = 0; i < ticks; i++) {
    script(battle.now + 1);
    frames.push(nextFrame(battle));
  }
  return frames;
}

describe('online battle inputs', () => {
  it('round-trips through the compact code', () => {
    const input = { ...NO_INPUT, moveX: -1, moveY: 1, fire: true, special: true, yell: true };
    expect(decodeInput(encodeInput(input))).toEqual(input);
    expect(decodeInput(encodeInput(NO_INPUT))).toEqual(NO_INPUT);
  });
});

describe('the ready-up lobby', () => {
  it('starts once everyone in the barracks is ready, and a new field resets readiness', () => {
    const state = room();
    const lobby = newLobby(state);
    const presence = new Map<string, Whereabouts>([[A, barracks], [B, barracks]]);
    lobby.ready.add(A);
    expect(readyToStart(state, lobby, presence)).toBeNull();
    lobby.ready.add(B);
    expect(readyToStart(state, lobby, presence)).toEqual([A, B]);
    expect(chooseField(state, lobby, 7)).toMatch(/not open/);
    expect(chooseField(state, lobby, 1)).toBeNull();
    expect(lobby.ready.size).toBe(2); // same field: still ready
    // Someone who is away or still on another screen doesn't hold the others up.
    lobby.ready.delete(B);
    expect(readyToStart(state, lobby, new Map<string, Whereabouts>([[A, barracks], [B, { at: 'battle', scenario: 1 }]]))).toEqual([A]);
    expect(readyToStart(state, lobby, new Map())).toBeNull();
  });
});

describe('lockstep battles', () => {
  it('replays identically on every device, with each player steering only their own squad', () => {
    const state = room();
    const lobby = newLobby(state);
    const battle = startBattle(state, lobby, [A, B], 'battle-1', 1234);
    const frames = run(battle, 300, (n) => {
      setInput(battle, 0, encodeInput({ ...NO_INPUT, moveX: n % 80 < 40 ? 1 : -1, fire: n % 5 === 0 }));
      setInput(battle, 1, encodeInput({ ...NO_INPUT, moveY: n % 60 < 30 ? -1 : 1, switchUnit: n === 50 }));
    });
    const one = new Lockstep(battle.setup, field('scen1'));
    const two = new Lockstep(battle.setup, field('scen1'));
    for (const frame of frames) one.play(frame);
    // A late viewer replays only the logged (non-empty) frames, filling in the rest.
    const logged = new Map(battle.log.map((f) => [f.n, f]));
    for (let n = 1; n <= battle.now; n++) two.play(logged.get(n) ?? { n });
    expect(snapshot(two.world)).toBe(snapshot(one.world));

    const [p0, p1] = one.world.players;
    expect(p0.control?.squad).toBe(0);
    expect(p1.control?.squad).toBe(1);
    expect(p1.control?.myguy?.name).toBe('MAGE1'); // switched within their own squad
  });

  it('lets a player join late, leave to the computer and come back', () => {
    const state = room();
    const battle = startBattle(state, newLobby(state), [A, B], 'battle-2', 99);
    const frames = run(battle, 40, () => setInput(battle, 0, encodeInput({ ...NO_INPUT, moveX: 1 })));
    expect(joinBattle(battle, state, C)).toBe(2);
    leaveBattle(battle, 1, true);
    frames.push(...run(battle, 20, () => undefined));
    const game = new Lockstep(battle.setup, field('scen1'));
    for (const frame of frames) game.play(frame);
    const world = game.world;
    expect(world.players[2].control?.myguy?.name).toBe('BARBARIAN1');
    expect(world.players[1].control).toBeNull(); // squad left to the computer
    expect(world.oblist.filter((o) => o.squad === 1 && !o.dead).every((o) => o.user === -1)).toBe(true);
    expect(joinBattle(battle, state, B)).toBe(1);
    game.play(nextFrame(battle));
    expect(world.players[1].control?.squad).toBe(1);
  });

  it('gives each press for one tick only, and an away player no input', () => {
    const state = room();
    const battle = startBattle(state, newLobby(state), [A, B], 'battle-3', 5);
    setInput(battle, 0, encodeInput({ ...NO_INPUT, moveX: 1, special: true }));
    const first = nextFrame(battle);
    const second = nextFrame(battle);
    expect(first.inputs).toEqual([[0, encodeInput({ ...NO_INPUT, moveX: 1, special: true })]]);
    expect(second.inputs).toEqual([[0, encodeInput({ ...NO_INPUT, moveX: 1 })]]);
    expect(nextFrame(battle).inputs).toBeUndefined(); // nothing changed
    leaveBattle(battle, 0, false);
    const away = nextFrame(battle);
    expect(away.inputs).toEqual([[0, 0]]);
    expect(away.events).toEqual([{ t: 'leave', player: 0 }]);
    setInput(battle, 0, encodeInput({ ...NO_INPUT, fire: true }));
    expect(nextFrame(battle).inputs).toBeUndefined();
  });

  it('pays every player for their own squad, including one who left', () => {
    const state = room();
    const battle = startBattle(state, newLobby(state), [A, B], 'battle-4', 7);
    leaveBattle(battle, 1, true);
    const before = [memberView(state, A).money, memberView(state, B).money];
    const record = { exp: 100, kills: 1, levelKills: 1, totalDamage: 5, totalHits: 2, totalShots: 3 };
    const reports = applyBattleResults(state, battle, 1, [
      { outcome: { result: 'victory', exitTo: 2 }, score: 200, ticks: 500, survivors: [{ from: 0, ...record }, { from: 1, ...record }] },
      { outcome: { result: 'victory', exitTo: 2 }, score: 50, ticks: 500, survivors: [{ from: 1, ...record }] },
    ]);
    expect(reports.get(A)?.cash).toBeGreaterThan(reports.get(B)!.cash);
    expect(memberView(state, A).money).toBe(before[0] + reports.get(A)!.cash);
    expect(memberView(state, B).team.map((g) => g.name)).toEqual(['MAGE1']);
    expect(reports.get(B)?.fallen).toEqual(['ELF1']);
    expect(memberView(state, C).open).toContain(2);
  });
});

describe('playing an online battle on a device', () => {
  it('never guesses a missing tick: it stops there and asks for the log', () => {
    const state = room();
    const battle = startBattle(state, newLobby(state), [A, B], 'battle-5', 11);
    const frames = run(battle, 6, (n) => setInput(battle, 0, encodeInput({ ...NO_INPUT, moveX: n < 4 ? 1 : -1 })));
    let asked = 0;
    const campaign = { joinBattle: () => asked++, sendInput: () => undefined } as unknown as OnlineCampaign;
    const device = new OnlineBattle(campaign, { t: 'battle', setup: battle.setup, frames: [], now: 0, you: 1 }, field('scen1'));
    // Tick 4 (where player 1 turns round) is lost on the way.
    device.add(frames.filter((f) => f.n !== 4));
    expect(device.backlog).toBe(3);
    expect(asked).toBe(1);
    while (device.playOne());
    expect(device.lockstep.tick).toBe(3);
    // The log fills the gap; the device then matches one that saw every tick.
    device.add(battle.log, battle.now);
    while (device.playOne());
    const reference = new Lockstep(battle.setup, field('scen1'));
    for (const frame of frames) reference.play(frame);
    expect(snapshot(device.world)).toBe(snapshot(reference.world));
  });
});
