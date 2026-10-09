// An online campaign's rules, as the server applies them. Each player has their own barracks
// (team, cash, progress) inside the shared campaign; fields anyone opens up are open to all.
// Plain data in, plain data out, so the server and the tests run the same code.

import {
  applyBattleSummary,
  baseStat,
  dismiss,
  hire,
  HIREABLE,
  MAX_TEAM,
  newCampaign,
  RECORD_FIELDS,
  setLeader,
  STATS,
  train,
  type BattleReport,
  type BattleSummary,
  type Campaign,
  type Survivor,
} from '../game/campaign.ts';
import { Guy } from '../sim/guy.ts';
import type { CampaignInfo, ClientMessage, GuyData, MemberCampaign, PublicMember, SquadEntry, Whereabouts } from './protocol.ts';

export const MAX_MEMBERS = 16;
/** Recent battle reports kept per player, so a result sent twice is applied once. */
const KEPT_RESULTS = 10;
const MAX_STAT = 10_000;
const MAX_LEVEL = 100;

export interface Member {
  name: string;
  joined: number;
  campaign: MemberCampaign;
  results: { id: string; report: BattleReport }[];
}

export interface RoomState {
  version: 1;
  id: string;
  name: string;
  difficulty: number;
  invite: string;
  owner: string;
  created: number;
  members: Record<string, Member>;
}

export function createRoom(init: { id: string; name: string; difficulty: number; invite: string; owner: string; ownerName: string; now: number }): RoomState {
  const state: RoomState = {
    version: 1,
    id: init.id,
    name: cleanTitle(init.name, 'Online campaign'),
    difficulty: int(init.difficulty, 0, 2),
    invite: init.invite,
    owner: init.owner,
    created: init.now,
    members: {},
  };
  addMember(state, init.owner, init.ownerName, init.now);
  return state;
}

/** Lets a player in: members always, newcomers with the right invite. Returns why not, or null. */
export function joinRoom(state: RoomState, playerId: string, name: string, invite: string | null, now: number): string | null {
  const member = state.members[playerId];
  if (member) {
    member.name = cleanTitle(name, member.name);
    return null;
  }
  if (invite !== state.invite) return 'This invite link is not valid. Ask for a new one.';
  if (Object.keys(state.members).length >= MAX_MEMBERS) return `This campaign is full (${MAX_MEMBERS} players).`;
  addMember(state, playerId, name, now);
  return null;
}

function addMember(state: RoomState, playerId: string, name: string, now: number): void {
  const fresh = newCampaign();
  state.members[playerId] = {
    name: cleanTitle(name, 'Player'),
    joined: now,
    campaign: { money: fresh.money, score: fresh.score, team: [], scenario: fresh.scenario, completed: [], hired: {} },
    results: [],
  };
}

/** Fields anyone may fight: the first, and every field a player has won or reached. */
export function openFields(state: RoomState): number[] {
  const open = new Set([1]);
  for (const { campaign } of Object.values(state.members)) {
    open.add(campaign.scenario);
    for (const n of campaign.completed) open.add(n);
  }
  return [...open].sort((a, b) => a - b);
}

/** A player's side of the campaign as a regular Campaign, so the usual rules apply to it. */
export function memberView(state: RoomState, playerId: string): Campaign {
  const c = state.members[playerId].campaign;
  return {
    version: 1,
    name: state.name,
    money: c.money,
    score: c.score,
    team: c.team.map(toGuy),
    scenario: c.scenario,
    completed: [...c.completed],
    hired: { ...c.hired },
    difficulty: state.difficulty,
    open: openFields(state),
  };
}

export function toMemberCampaign(view: Campaign): MemberCampaign {
  return { money: view.money, score: view.score, team: view.team.map(toData), scenario: view.scenario, completed: [...view.completed], hired: { ...view.hired } };
}

/** What the lobby and the battle being fought look like, for campaignInfo. */
export interface PlayState {
  field: number;
  ready: ReadonlySet<string>;
  battle: { id: string; scenario: number; players: readonly { id: string; away: boolean }[] } | null;
}

export function campaignInfo(state: RoomState, viewer: string, presence: ReadonlyMap<string, Whereabouts>, play?: PlayState): CampaignInfo {
  const battle = play?.battle ?? null;
  const members: PublicMember[] = Object.entries(state.members)
    .sort(([, a], [, b]) => a.joined - b.joined)
    .map(([id, m]) => ({
      name: m.name,
      online: presence.has(id),
      where: presence.get(id) ?? null,
      teamSize: m.campaign.team.length,
      topLevel: Math.max(0, ...m.campaign.team.map((g) => g.level)),
      score: m.campaign.score,
      ready: play?.ready.has(id) ?? false,
      inBattle: battle?.players.some((p) => p.id === id) ?? false,
      you: id === viewer,
    }));
  const open = openFields(state);
  return {
    id: state.id,
    name: state.name,
    difficulty: state.difficulty,
    invite: state.invite,
    open,
    members,
    field: play?.field ?? Math.max(...open),
    battle: battle && {
      id: battle.id,
      scenario: battle.scenario,
      playing: battle.players.filter((p) => !p.away).map((p) => state.members[p.id]?.name ?? '?'),
    },
  };
}

export type ActResult = { error?: string; report?: BattleReport };

/** Applies one player's action to their barracks. Everything from the client is checked. */
export function act(state: RoomState, playerId: string, msg: Exclude<ClientMessage, { t: 'where' }>): ActResult {
  const member = state.members[playerId];
  if (!member) return { error: 'You are not in this campaign.' };
  if (msg.t === 'result') {
    const earlier = member.results.find((r) => r.id === msg.id);
    if (earlier) return { report: earlier.report };
  }
  const view = memberView(state, playerId);
  const result = apply(view, msg);
  if (result.error) return result;
  member.campaign = toMemberCampaign(view);
  if (msg.t === 'result' && result.report) {
    member.results = [{ id: String(msg.id), report: result.report }, ...member.results].slice(0, KEPT_RESULTS);
  }
  return result;
}

function apply(view: Campaign, msg: Exclude<ClientMessage, { t: 'where' }>): ActResult {
  const failed = (r: { ok: boolean; reason?: string }): ActResult => (r.ok ? {} : { error: r.reason });
  switch (msg.t) {
    case 'hire': {
      const family = Number(msg.guy?.family);
      if (!HIREABLE.includes(family)) return { error: 'That kind of recruit is not for hire.' };
      const guy = new Guy(family);
      guy.name = cleanGuyName(msg.guy.name, `${guy.name}${(view.hired[family] ?? 0) + 1}`);
      for (const stat of STATS) guy[stat] = int(msg.guy[stat], baseStat(family, stat), stat === 'level' ? MAX_LEVEL : MAX_STAT);
      return failed(hire(view, guy));
    }
    case 'train': {
      const current = view.team[msg.index];
      if (!current) return { error: 'No such team member.' };
      const proposal = current.clone();
      for (const stat of STATS) proposal[stat] = int(msg.guy?.[stat], current[stat], stat === 'level' ? MAX_LEVEL : MAX_STAT);
      proposal.name = cleanGuyName(msg.guy?.name, current.name);
      return failed(train(view, msg.index, proposal));
    }
    case 'dismiss':
      if (!view.team[msg.index]) return { error: 'No such team member.' };
      dismiss(view, msg.index);
      return {};
    case 'leader':
      if (!view.team[msg.index]) return { error: 'No such team member.' };
      setLeader(view, msg.index);
      return {};
    case 'result':
      return applyResult(view, msg);
    default:
      return { error: 'Unknown action.' };
  }
}

function applyResult(view: Campaign, msg: Extract<ClientMessage, { t: 'result' }>): ActResult {
  if (!sameSquad(view.team, msg.squad)) return { error: 'Your team changed during that battle, so its result was not saved.' };
  const scenario = int(msg.scenario, 1, 999);
  const unlocked = new Set([...view.completed, ...(view.open ?? []), view.scenario]);
  if (!unlocked.has(scenario)) return { error: `Field ${scenario} is not open yet.` };
  view.scenario = scenario;
  const squad = view.team;
  return { report: applyBattleSummary(view, cleanSummary(msg.summary, squad), squad, int(msg.par, 1, 1000)) };
}

export function sameSquad(team: readonly Guy[], squad: readonly SquadEntry[] | undefined): boolean {
  return Array.isArray(squad) && squad.length === team.length && team.every((g, i) => squad[i]?.name === g.name && squad[i]?.family === g.family);
}

/** A summary from the client, with only sensible values kept. Records never go down. */
export function cleanSummary(summary: BattleSummary, squad: readonly Guy[]): BattleSummary {
  const o = summary?.outcome;
  const exitTo = o && 'exitTo' in o && o.exitTo !== undefined ? int(o.exitTo, 1, 999) : undefined;
  const outcome: BattleSummary['outcome'] =
    o?.result === 'victory' ? { result: 'victory', exitTo }
    : o?.result === 'retreat' && exitTo !== undefined ? { result: 'retreat', exitTo }
    : { result: 'defeat', reason: o?.result === 'defeat' ? String(o.reason ?? '').slice(0, 200) : 'Battle abandoned.' };
  const survivors: Survivor[] = [];
  for (const s of Array.isArray(summary?.survivors) ? summary.survivors.slice(0, MAX_TEAM * 2) : []) {
    const before = squad[int(s?.from, -1, squad.length)];
    if (!before) continue;
    const survivor = { from: squad.indexOf(before) } as Survivor;
    for (const field of RECORD_FIELDS) survivor[field] = Math.max(before[field], int(s[field], 0, 1e9));
    survivors.push(survivor);
  }
  return { outcome, score: int(summary?.score, 0, 1e7), ticks: int(summary?.ticks, 0, 1e9), survivors };
}

export function toData(guy: Guy): GuyData {
  return {
    name: guy.name,
    family: guy.family,
    strength: guy.strength,
    dexterity: guy.dexterity,
    constitution: guy.constitution,
    intelligence: guy.intelligence,
    armor: guy.armor,
    level: guy.level,
    exp: guy.exp,
    kills: guy.kills,
    levelKills: guy.levelKills,
    totalDamage: guy.totalDamage,
    totalHits: guy.totalHits,
    totalShots: guy.totalShots,
    teamnum: guy.teamnum,
    leader: guy.leader,
  };
}

export function toGuy(data: GuyData): Guy {
  return Object.assign(new Guy(data.family), data);
}

/** A whole number in [min, max]; anything else becomes min. */
function int(value: unknown, min: number, max: number): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

/** Unit names are like the original's: up to 11 plain capitals. */
function cleanGuyName(name: unknown, fallback: string): string {
  const clean = String(name ?? '').toUpperCase().replace(/[^\x20-\x7E]/g, '').trim().slice(0, 11);
  return clean || fallback;
}

/** Player and campaign names: any letters, no control characters, a sensible length. */
export function cleanTitle(name: unknown, fallback: string): string {
  const clean = String(name ?? '').replace(/[\p{C}]/gu, '').trim().slice(0, 24);
  return clean || fallback;
}
