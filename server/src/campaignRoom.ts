// One online campaign: its saved state, the players connected to it, the ready-up lobby and the
// battle being fought. Players talk to it over WebSockets; it applies their actions and tells
// everyone what changed. In a battle it is the clock: every tick it relays what changed in
// players' inputs, and each player's device runs the same battle from that (see lockstep.ts).
// Sockets use the hibernation API, so a quiet campaign costs nothing; a battle keeps it awake.

import { DurableObject } from 'cloudflare:workers';
import {
  ABANDON_AFTER_MS,
  applyBattleResults,
  AWAY_AFTER_MS,
  chooseField,
  everyoneLeft,
  fieldOpen,
  fighting,
  joinBattle,
  leaveBattle,
  newLobby,
  nextFrame,
  playerIndex,
  readyToStart,
  setInput,
  settleArenaRun,
  startBattle,
  type Lobby,
  type ServerBattle,
} from '../../src/online/battle.ts';
import type { Frame } from '../../src/online/lockstep.ts';
import { CLOSE_FORBIDDEN, PROTOCOL_VERSION, type ClientMessage, type ServerMessage, type Whereabouts } from '../../src/online/protocol.ts';
import { ARENA_FIELD, isArena } from '../../src/game/arena.ts';
import { act, campaignInfo, createRoom, joinRoom, memberView, openFields, toMemberCampaign, type RoomState } from '../../src/online/room.ts';
import type { Env } from './env.ts';

interface Attachment {
  playerId: string;
  where: Whereabouts;
  /** Ready for the next battle (kept on the socket, so it survives hibernation). */
  ready?: boolean;
  /** The battle this socket is playing. */
  battle?: string;
}

/** How often the battle clock checks the time; ticks themselves come every ONLINE_TICK_MS. */
const CLOCK_MS = 20;
/** A slow timer never makes a burst of more ticks than this. */
const MAX_BURST = 10;

export class CampaignRoom extends DurableObject<Env> {
  private state: RoomState | null = null;
  /** The field everyone is getting ready for (saved, so it survives hibernation). */
  private field = 1;
  private battle: ServerBattle | null = null;
  private clock = 0;
  private clockLast = 0;
  private clockDebt = 0;
  /** When a player's last connection to the battle dropped, by player number. */
  private readonly droppedAt = new Map<number, number>();
  /** Since when nobody has been connected to the battle. */
  private emptySince: number | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered without waking the campaign up: keeps phones' connections checked for free.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<RoomState>('state')) ?? null;
      if (this.state) this.field = (await ctx.storage.get<number>('field')) ?? newLobby(this.state).field;
    });
  }

  async create(init: Parameters<typeof createRoom>[0]): Promise<void> {
    if (this.state) throw new Error('Campaign already exists');
    this.state = createRoom(init);
    this.field = 1;
    await this.save();
  }

  /** A player connecting: the worker has already checked who they are (X-Player). */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const playerId = request.headers.get('X-Player') ?? '';
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);

    const state = this.state;
    const refusal =
      url.searchParams.get('v') !== String(PROTOCOL_VERSION)
        ? 'A new version of the game is out. Reload the page (or tap Reload when asked) to keep playing online.'
        : state
          ? joinRoom(state, playerId, url.searchParams.get('name') ?? '', url.searchParams.get('invite'), Date.now())
          : 'This campaign does not exist.';
    if (refusal || !state) {
      send(server, { t: 'error', reason: refusal ?? 'This campaign does not exist.', fatal: true });
      server.close(CLOSE_FORBIDDEN, 'Not allowed');
    } else {
      server.serializeAttachment({ playerId, where: { at: 'barracks' } } satisfies Attachment);
      await this.save();
      this.broadcast();
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    const state = this.state;
    if (!attachment || !state || typeof data !== 'string') return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data) as ClientMessage;
    } catch {
      return;
    }
    const playerId = attachment.playerId;
    const battle = this.battle;

    switch (msg.t) {
      case 'input':
        if (battle && attachment.battle === battle.setup.id) setInput(battle, playerIndex(battle, playerId), msg.code);
        return;

      case 'where':
        attachment.where = cleanWhere(msg.where);
        if (attachment.where.at !== 'barracks') attachment.ready = false;
        ws.serializeAttachment(attachment);
        this.startIfReady();
        this.broadcast();
        return;

      case 'field': {
        if (battle) return this.refuse(ws, 'Wait for the battle being fought to end.');
        const lobby = this.lobby();
        const refusal = chooseField(state, lobby, Math.trunc(Number(msg.scenario)));
        if (refusal) return this.refuse(ws, refusal);
        if (lobby.field !== this.field) {
          this.field = lobby.field;
          await this.ctx.storage.put('field', this.field);
        }
        if (!lobby.ready.size) this.setReady(() => false);
        this.broadcast();
        return;
      }

      case 'ready':
        if (battle) return this.refuse(ws, 'A battle is on: join it instead.');
        if (msg.ready && !state.members[playerId]?.campaign.team.length) return this.refuse(ws, 'Hire someone before you go to battle.');
        this.setReady((a) => (a.playerId === playerId ? msg.ready === true : a.ready === true));
        this.startIfReady();
        this.broadcast();
        return;

      case 'battle-join': {
        if (!battle) return this.refuse(ws, 'That battle is over.');
        if (playerIndex(battle, playerId) >= 0 && !fighting(battle, playerId)) return this.refuse(ws, 'Your arena run is over. Wait for your friends to finish theirs.');
        if (playerIndex(battle, playerId) < 0 && !state.members[playerId]?.campaign.team.length) {
          return this.refuse(ws, 'Hire someone before you go to battle.');
        }
        const you = joinBattle(battle, state, playerId);
        this.droppedAt.delete(you);
        this.follow(ws, attachment, battle, you);
        this.broadcast();
        return;
      }

      case 'battle-leave':
        if (battle && attachment.battle === battle.setup.id) {
          leaveBattle(battle, playerIndex(battle, playerId), true);
          attachment.battle = undefined;
          ws.serializeAttachment(attachment);
          if (everyoneLeft(battle)) this.endBattle('Everyone left the battle.');
          this.broadcast();
        }
        return;

      case 'arena-choice': {
        const player = battle ? playerIndex(battle, playerId) : -1;
        if (battle && player >= 0 && fighting(battle, playerId) && isArena(battle.setup.scenario)) {
          battle.pending.push({ t: 'choice', player, leave: msg.leave === true });
        }
        return;
      }

      case 'arena-done': {
        // Every device says so: the first settles the run, the rest change nothing.
        const player = Math.trunc(Number(msg.player));
        if (!battle || msg.id !== battle.setup.id || playerIndex(battle, playerId) < 0 || !battle.players[player]) return;
        const report = settleArenaRun(state, battle, player, Number(msg.par), msg.summary ?? null);
        if (!report) return;
        await this.save();
        const settled = battle.players[player].id;
        for (const socket of this.ctx.getWebSockets()) {
          const a = socket.deserializeAttachment() as Attachment | null;
          if (a?.playerId === settled) send(socket, { t: 'report', id: battle.setup.id, report });
        }
        if (everyoneLeft(battle)) this.endBattle('Everyone has left the arena.');
        this.broadcast();
        return;
      }

      case 'battle-result': {
        if (!battle || msg.id !== battle.setup.id || playerIndex(battle, playerId) < 0) return;
        const reports = applyBattleResults(state, battle, Number(msg.par), Array.isArray(msg.summaries) ? msg.summaries : []);
        await this.save();
        for (const socket of this.ctx.getWebSockets()) {
          const a = socket.deserializeAttachment() as Attachment | null;
          const report = a && reports.get(a.playerId);
          if (report) send(socket, { t: 'report', id: battle.setup.id, report });
        }
        this.endBattle('The battle is over.');
        this.broadcast();
        return;
      }

      default: {
        // Barracks changes: not while your squad is out fighting.
        if (battle && fighting(battle, playerId)) return this.refuse(ws, 'Your squad is in battle. Changes wait until it ends.');
        const result = act(state, playerId, msg);
        if (result.error) {
          send(ws, { t: 'error', reason: result.error, id: msg.t === 'result' ? msg.id : undefined });
          this.sendState(ws, playerId, this.presence()); // undo the player's guess at the outcome
          return;
        }
        await this.save();
        if (msg.t === 'result' && result.report) send(ws, { t: 'report', id: msg.id, report: result.report });
        this.broadcast();
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, 'Bye');
    } catch {
      // already closed
    }
    this.startIfReady(ws);
    this.broadcast(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcast(ws);
  }

  // --- The lobby -----------------------------------------------------------------------

  private lobby(leaving?: WebSocket): Lobby {
    const ready = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (ws !== leaving && a?.ready && ws.readyState === WebSocket.OPEN) ready.add(a.playerId);
    }
    return { field: this.field, ready };
  }

  private setReady(ready: (a: Attachment) => boolean): void {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a) continue;
      a.ready = ready(a);
      ws.serializeAttachment(a);
    }
  }

  /** Starts the battle once everyone in the barracks is ready. */
  private startIfReady(leaving?: WebSocket): void {
    const state = this.state;
    if (!state || this.battle) return;
    const lobby = this.lobby(leaving);
    if (!fieldOpen(state, lobby.field)) lobby.field = Math.max(...openFields(state));
    const players = readyToStart(state, lobby, this.presence(leaving));
    if (!players?.every((id) => state.members[id].campaign.team.length)) return;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const battle = startBattle(state, lobby, players, crypto.randomUUID(), seed);
    this.battle = battle;
    this.setReady(() => false);
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (ws !== leaving && a && players.includes(a.playerId) && a.where.at === 'barracks') this.follow(ws, a, battle, playerIndex(battle, a.playerId));
    }
    this.clockLast = Date.now();
    this.clockDebt = 0;
    this.emptySince = null;
    this.droppedAt.clear();
    this.clock = setInterval(() => this.runClock(), CLOCK_MS) as unknown as number;
  }

  /** Sends a socket into the battle: everything so far, then the ticks as they come. */
  private follow(ws: WebSocket, a: Attachment, battle: ServerBattle, you: number): void {
    a.battle = battle.setup.id;
    a.ready = false;
    a.where = { at: 'battle', scenario: battle.setup.scenario };
    ws.serializeAttachment(a);
    send(ws, { t: 'battle', setup: battle.setup, frames: battle.log, now: battle.now, you });
  }

  // --- The battle clock ------------------------------------------------------------------

  private runClock(): void {
    const battle = this.battle;
    if (!battle) return;
    const now = Date.now();
    const sockets = this.battleSockets(battle);
    const connected = new Set(sockets.map(({ a }) => playerIndex(battle, a.playerId)));

    // Someone whose connection dropped keeps their squad a moment, then the computer takes over.
    let changed = false;
    battle.players.forEach((p, i) => {
      if (connected.has(i) || p.away) return this.droppedAt.delete(i);
      const since = this.droppedAt.get(i) ?? now;
      this.droppedAt.set(i, since);
      if (now - since >= AWAY_AFTER_MS) {
        leaveBattle(battle, i, false);
        changed = true;
      }
    });

    // Nobody connected: the battle waits (a train in a tunnel), and is given up after a while.
    if (!sockets.length) {
      this.clockLast = now;
      this.emptySince ??= now;
      if (now - this.emptySince >= ABANDON_AFTER_MS) {
        this.endBattle('Nobody came back to the battle.');
        this.broadcast();
      }
      return;
    }
    this.emptySince = null;

    this.clockDebt += now - this.clockLast;
    this.clockLast = now;
    const frames: Frame[] = [];
    while (this.clockDebt >= battle.setup.tickMs && frames.length < MAX_BURST) {
      frames.push(nextFrame(battle));
      this.clockDebt -= battle.setup.tickMs;
    }
    if (frames.length === MAX_BURST) this.clockDebt = 0;
    if (frames.length) {
      const msg = JSON.stringify({ t: 'ticks', frames } satisfies ServerMessage);
      for (const { ws } of sockets) {
        try {
          ws.send(msg);
        } catch {
          // gone; its close catches up
        }
      }
    }
    if (changed) this.broadcast();
  }

  private battleSockets(battle: ServerBattle): { ws: WebSocket; a: Attachment }[] {
    const sockets: { ws: WebSocket; a: Attachment }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.battle === battle.setup.id && ws.readyState === WebSocket.OPEN) sockets.push({ ws, a });
    }
    return sockets;
  }

  private endBattle(reason: string): void {
    const battle = this.battle;
    if (!battle) return;
    clearInterval(this.clock);
    for (const { ws, a } of this.battleSockets(battle)) {
      send(ws, { t: 'battle-end', id: battle.setup.id, reason });
      a.battle = undefined;
      ws.serializeAttachment(a);
    }
    this.battle = null;
  }

  // --- Telling players --------------------------------------------------------------------

  private refuse(ws: WebSocket, reason: string): void {
    send(ws, { t: 'error', reason });
  }

  private async save(): Promise<void> {
    if (this.state) await this.ctx.storage.put('state', this.state);
  }

  /** Who is connected and where, leaving out a socket that is closing. */
  private presence(leaving?: WebSocket): Map<string, Whereabouts> {
    const presence = new Map<string, Whereabouts>();
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      if (ws !== leaving && attachment && ws.readyState === WebSocket.OPEN) presence.set(attachment.playerId, attachment.where);
    }
    return presence;
  }

  private broadcast(leaving?: WebSocket): void {
    const presence = this.presence(leaving);
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      if (ws !== leaving && attachment) this.sendState(ws, attachment.playerId, presence, leaving);
    }
  }

  private sendState(ws: WebSocket, playerId: string, presence: ReadonlyMap<string, Whereabouts>, leaving?: WebSocket): void {
    const state = this.state;
    if (!state?.members[playerId]) return;
    const battle = this.battle;
    const lobby = this.lobby(leaving);
    const play = {
      field: lobby.field,
      ready: lobby.ready,
      battle: battle && { id: battle.setup.id, scenario: battle.setup.scenario, players: battle.players.filter((p) => !p.done) },
    };
    send(ws, { t: 'state', campaign: campaignInfo(state, playerId, presence, play), you: toMemberCampaign(memberView(state, playerId)) });
  }
}

function send(ws: WebSocket, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // the socket went away; presence catches up on its close
  }
}

function cleanWhere(where: unknown): Whereabouts {
  const w = where as Whereabouts | undefined;
  if (w?.at === 'battle') {
    const scenario = Math.trunc(Number(w.scenario));
    if (scenario >= 1 && scenario <= ARENA_FIELD) return { at: 'battle', scenario };
  }
  return { at: 'barracks' };
}
