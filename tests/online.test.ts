import { describe, expect, it } from 'vitest';
import { LivingFamily as L } from '../src/data/objects.ts';
import { hireCost, recruit, type BattleSummary } from '../src/game/campaign.ts';
import type { ClientMessage, GuyData } from '../src/online/protocol.ts';
import { act, campaignInfo, createRoom, joinRoom, memberView, openFields, toData, type RoomState } from '../src/online/room.ts';
import { makeToken, passwordVersion, readToken, samePassword, signingKey } from '../server/src/auth.ts';

const OWNER = 'a'.repeat(32);
const FRIEND = 'b'.repeat(32);

function room(): RoomState {
  const state = createRoom({ id: 'c'.repeat(64), name: 'Train trip', difficulty: 1, invite: 'i'.repeat(24), owner: OWNER, ownerName: 'Ricardo', now: 1 });
  expect(joinRoom(state, FRIEND, 'Irmão', 'i'.repeat(24), 2)).toBeNull();
  return state;
}

function recruitData(state: RoomState, player: string, family: number): GuyData {
  return toData(recruit(memberView(state, player), family));
}

function hireTwo(state: RoomState, player: string): void {
  expect(act(state, player, { t: 'hire', guy: recruitData(state, player, L.SOLDIER) }).error).toBeUndefined();
  expect(act(state, player, { t: 'hire', guy: recruitData(state, player, L.ELF) }).error).toBeUndefined();
}

function result(state: RoomState, player: string, summary: Partial<BattleSummary>, extra: Partial<Extract<ClientMessage, { t: 'result' }>> = {}): Extract<ClientMessage, { t: 'result' }> {
  const team = memberView(state, player).team;
  return {
    t: 'result',
    id: 'battle-1',
    scenario: 1,
    par: 1,
    squad: team.map((g) => ({ name: g.name, family: g.family })),
    summary: { outcome: { result: 'victory', exitTo: 2 }, score: 300, ticks: 1000, survivors: [], ...summary },
    ...extra,
  };
}

describe('online campaign room', () => {
  it('lets members in, and newcomers only with the invite', () => {
    const state = room();
    expect(joinRoom(state, 'd'.repeat(32), 'Stranger', 'wrong', 3)).toMatch(/invite/);
    expect(joinRoom(state, FRIEND, 'Mano', null, 4)).toBeNull(); // members need no invite, and can rename
    expect(campaignInfo(state, FRIEND, new Map()).members.map((m) => [m.name, m.you])).toEqual([['Ricardo', false], ['Mano', true]]);
  });

  it('gives each player their own barracks and cash', () => {
    const state = room();
    hireTwo(state, OWNER);
    expect(memberView(state, OWNER).team.map((g) => g.name)).toEqual(['SOLDIER1', 'ELF1']);
    expect(memberView(state, FRIEND).team).toEqual([]);
    expect(memberView(state, FRIEND).money).toBe(5000);
  });

  it('checks recruits: real families, stats no lower than base, prices from the server', () => {
    const state = room();
    expect(act(state, OWNER, { t: 'hire', guy: { ...recruitData(state, OWNER, L.SOLDIER), family: 99 } }).error).toBeTruthy();
    const cheat = { ...recruitData(state, OWNER, L.SOLDIER), strength: -50, name: 'soldier<b>' };
    act(state, OWNER, { t: 'hire', guy: cheat });
    const hired = memberView(state, OWNER).team[0];
    expect(hired.strength).toBe(12);
    expect(hired.name).toBe('SOLDIER<B>');
    expect(memberView(state, OWNER).money).toBe(5000 - hireCost(hired));
    const rich = { ...recruitData(state, OWNER, L.MAGE), intelligence: 10_000 };
    expect(act(state, OWNER, { t: 'hire', guy: rich }).error).toBe('Not enough cash.');
  });

  it('trains, dismisses and picks a leader, refusing bad indices', () => {
    const state = room();
    hireTwo(state, OWNER);
    const proposal = { ...toData(memberView(state, OWNER).team[0]), strength: 14, dexterity: 1 };
    expect(act(state, OWNER, { t: 'train', index: 0, guy: proposal }).error).toBeUndefined();
    expect(memberView(state, OWNER).team[0].strength).toBe(14);
    expect(memberView(state, OWNER).team[0].dexterity).toBe(6); // training never lowers a stat
    expect(act(state, OWNER, { t: 'leader', index: 1 }).error).toBeUndefined();
    expect(memberView(state, OWNER).team.map((g) => g.leader)).toEqual([false, true]);
    expect(act(state, OWNER, { t: 'dismiss', index: 5 }).error).toBeTruthy();
    expect(act(state, OWNER, { t: 'dismiss', index: 0 }).error).toBeUndefined();
    expect(memberView(state, OWNER).team.map((g) => g.name)).toEqual(['ELF1']);
  });

  it('applies a won battle once, and opens the next field for everyone', () => {
    const state = room();
    hireTwo(state, OWNER);
    const before = memberView(state, OWNER).money;
    const msg = result(state, OWNER, { survivors: [{ from: 1, exp: 900, kills: 4, levelKills: 4, totalDamage: 50, totalHits: 9, totalShots: 12 }] });
    const first = act(state, OWNER, msg);
    expect(first.report?.outcome.result).toBe('victory');
    expect(first.report?.fallen).toEqual(['SOLDIER1']);
    const after = memberView(state, OWNER);
    expect(after.money).toBe(before + first.report!.cash);
    expect(after.team.map((g) => [g.name, g.kills])).toEqual([['ELF1', 4]]);
    expect(openFields(state)).toEqual([1, 2]);
    expect(memberView(state, FRIEND).open).toEqual([1, 2]);
    // The same battle sent again (say, after a dropped connection) changes nothing.
    expect(act(state, OWNER, msg).report).toEqual(first.report);
    expect(memberView(state, OWNER).money).toBe(after.money);
  });

  it('refuses results that do not fit the team or the open fields', () => {
    const state = room();
    hireTwo(state, OWNER);
    expect(act(state, OWNER, result(state, OWNER, {}, { squad: [{ name: 'SOLDIER1', family: L.SOLDIER }] })).error).toMatch(/team changed/);
    expect(act(state, OWNER, result(state, OWNER, {}, { scenario: 7 })).error).toMatch(/not open/);
  });

  it('never lets a record go down, and keeps both halves of a split slime', () => {
    const state = room();
    act(state, OWNER, { t: 'hire', guy: recruitData(state, OWNER, L.SMALL_SLIME) });
    act(state, OWNER, result(state, OWNER, { survivors: [{ from: 0, exp: 500, kills: 2, levelKills: 2, totalDamage: 0, totalHits: 0, totalShots: 0 }] }));
    const record = { from: 0, exp: 0, kills: 0, levelKills: 0, totalDamage: 0, totalHits: 0, totalShots: 0 };
    act(state, OWNER, result(state, OWNER, { survivors: [record, record] }, { id: 'battle-2', scenario: 2 }));
    expect(memberView(state, OWNER).team.map((g) => [g.exp, g.kills])).toEqual([[500, 2], [500, 2]]);
  });
});

describe('online sign-in tokens', () => {
  it('signs, verifies and rejects tampering', async () => {
    const key = await signingKey('secret');
    const version = await passwordVersion('secret', 'letmein');
    const token = await makeToken(key, OWNER, version);
    expect(await readToken(key, token)).toEqual({ playerId: OWNER, version });
    expect(await readToken(key, token.replace(OWNER, FRIEND))).toBeNull();
    expect(await readToken(await signingKey('other'), token)).toBeNull();
    expect(await readToken(key, 'garbage')).toBeNull();
  });

  it('tells password versions apart and compares passwords', async () => {
    expect(await passwordVersion('s', 'one')).not.toBe(await passwordVersion('s', 'two'));
    expect(await samePassword('letmein', 'letmein')).toBe(true);
    expect(await samePassword('letmeout', 'letmein')).toBe(false);
    expect(await samePassword(undefined, 'letmein')).toBe(false);
  });
});
