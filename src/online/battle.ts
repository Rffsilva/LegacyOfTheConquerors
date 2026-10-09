// The server's side of an online battle: the ready-up lobby that starts it, and the clock that
// turns players' inputs into frames (see lockstep.ts). Plain data and functions, so the
// Durable Object stays a thin layer of sockets and timers, and the tests can drive it directly.

import { applyBattleSummary, squadFor, type BattleReport, type BattleSummary } from '../game/campaign.ts';
import { PRESSES, type BattleEvent, type BattleSetup, type Frame } from './lockstep.ts';
import type { GuyData, Whereabouts } from './protocol.ts';
import { cleanSummary, memberView, openFields, sameSquad, toData, toMemberCampaign, type RoomState } from './room.ts';

/** The original's default speed (8), as milliseconds per tick: online battles all run at it. */
export const ONLINE_TICK_MS = 6 * 13.6;
/** A player whose connection dropped keeps control this long before the computer takes over. */
export const AWAY_AFTER_MS = 10_000;
/** A battle nobody is connected to is given up after this long. */
export const ABANDON_AFTER_MS = 15 * 60_000;

export interface Lobby {
  field: number;
  ready: Set<string>;
}

export interface BattlePlayer {
  id: string;
  name: string;
  /** Buttons held now, and presses waiting for the next tick. */
  held: number;
  presses: number;
  /** The input code the last frame gave this player. */
  last: number;
  /** Their squad is under the computer (they left or lost connection). */
  away: boolean;
  /** They chose to leave (rather than losing connection). */
  left: boolean;
}

export interface ServerBattle {
  setup: BattleSetup;
  /** The last tick issued. */
  now: number;
  /** Every frame that wasn't empty, for players joining later. */
  log: Frame[];
  players: BattlePlayer[];
  /** Each player's squad as it entered the battle (what the results refer to). */
  squads: GuyData[][];
  pending: BattleEvent[];
}

export function newLobby(state: RoomState): Lobby {
  return { field: Math.max(...openFields(state)), ready: new Set() };
}

/** Changes the field everyone is getting ready for; readiness starts over. Returns why not, or null. */
export function chooseField(state: RoomState, lobby: Lobby, field: number): string | null {
  if (!openFields(state).includes(field)) return `Field ${field} is not open yet.`;
  if (lobby.field !== field) lobby.ready.clear();
  lobby.field = field;
  return null;
}

/**
 * Who would fight if the battle started now: the players in the barracks, once every one of
 * them is ready. Null while someone there isn't ready yet (or nobody is there).
 */
export function readyToStart(state: RoomState, lobby: Lobby, presence: ReadonlyMap<string, Whereabouts>): string[] | null {
  const here = [...presence].filter(([id, where]) => where.at === 'barracks' && state.members[id]).map(([id]) => id);
  if (!here.length || !here.every((id) => lobby.ready.has(id))) return null;
  return here.sort((a, b) => state.members[a].joined - state.members[b].joined);
}

export function startBattle(state: RoomState, lobby: Lobby, playerIds: string[], id: string, seed: number): ServerBattle {
  const views = playerIds.map((p) => memberView(state, p));
  const setup: BattleSetup = {
    id,
    scenario: lobby.field,
    seed: seed >>> 0,
    difficulty: state.difficulty,
    completed: [...new Set(views.flatMap((v) => v.completed))].sort((a, b) => a - b),
    alreadyWon: views.every((v) => v.completed.includes(lobby.field)),
    tickMs: ONLINE_TICK_MS,
    squads: views.map((v) => squadFor(v).map(toData)),
    names: playerIds.map((p) => state.members[p].name),
  };
  lobby.ready.clear();
  return {
    setup,
    now: 0,
    log: [],
    players: playerIds.map((p, i) => ({ id: p, name: setup.names[i], held: 0, presses: 0, last: 0, away: false, left: false })),
    squads: setup.squads,
    pending: [],
  };
}

export function playerIndex(battle: ServerBattle, playerId: string): number {
  return battle.players.findIndex((p) => p.id === playerId);
}

/**
 * Brings a player into the battle: back in control of their squad if they were in it, or with
 * their squad arriving now if not. Returns their player number.
 */
export function joinBattle(battle: ServerBattle, state: RoomState, playerId: string): number {
  const existing = playerIndex(battle, playerId);
  if (existing >= 0) {
    const p = battle.players[existing];
    if (p.away) battle.pending.push({ t: 'return', player: existing });
    p.away = false;
    p.left = false;
    return existing;
  }
  const player = battle.players.length;
  const name = state.members[playerId].name;
  const squad = squadFor(memberView(state, playerId)).map(toData);
  battle.players.push({ id: playerId, name, held: 0, presses: 0, last: 0, away: false, left: false });
  battle.squads.push(squad);
  battle.pending.push({ t: 'join', player, name, squad });
  return player;
}

/** The player's squad goes over to the computer: they chose to leave, or their connection is gone. */
export function leaveBattle(battle: ServerBattle, player: number, chose: boolean): void {
  const p = battle.players[player];
  if (!p) return;
  if (!p.away) battle.pending.push({ t: 'leave', player });
  p.away = true;
  p.left ||= chose;
  p.held = 0;
  p.presses = 0;
}

export function setInput(battle: ServerBattle, player: number, code: number): void {
  const p = battle.players[player];
  if (!p || p.away) return;
  const clean = Math.trunc(Number(code)) & 1023;
  p.held = clean & ~PRESSES;
  p.presses |= clean & PRESSES;
}

/** Issues the next tick: what changed since the last one. */
export function nextFrame(battle: ServerBattle): Frame {
  const frame: Frame = { n: battle.now + 1 };
  const inputs: [number, number][] = [];
  battle.players.forEach((p, i) => {
    const code = p.away ? 0 : p.held | p.presses;
    p.presses = 0;
    if (code !== p.last) inputs.push([i, code]);
    p.last = code;
  });
  if (inputs.length) frame.inputs = inputs;
  if (battle.pending.length) frame.events = battle.pending.splice(0);
  if (frame.inputs || frame.events) battle.log.push(frame);
  battle.now = frame.n;
  return frame;
}

/**
 * Applies a finished battle to everyone who fought in it (including players who left: their
 * squads fought on). `summaries` is indexed by player number. Returns each player's report.
 */
export function applyBattleResults(state: RoomState, battle: ServerBattle, par: number, summaries: readonly (BattleSummary | null)[]): Map<string, BattleReport> {
  const reports = new Map<string, BattleReport>();
  battle.players.forEach((p, i) => {
    const summary = summaries[i];
    const member = state.members[p.id];
    if (!summary || !member) return;
    const view = memberView(state, p.id);
    if (!sameSquad(view.team, battle.squads[i])) return;
    view.scenario = battle.setup.scenario;
    const report = applyBattleSummary(view, cleanSummary(summary, view.team), view.team, Math.max(1, Math.min(1000, Math.trunc(par) || 1)));
    member.campaign = toMemberCampaign(view);
    member.results = [{ id: battle.setup.id, report }, ...member.results].slice(0, 10);
    reports.set(p.id, report);
  });
  return reports;
}

/** Everyone has chosen to leave: the battle is over, with nothing won or lost. */
export function everyoneLeft(battle: ServerBattle): boolean {
  return battle.players.every((p) => p.left);
}
