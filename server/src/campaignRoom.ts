// One online campaign: its saved state, and the players connected to it. Players talk to it
// over a WebSocket; it applies their actions and tells everyone what changed. Sockets use the
// hibernation API, so a quiet campaign costs nothing while players sit in their barracks.

import { DurableObject } from 'cloudflare:workers';
import { CLOSE_FORBIDDEN, type ClientMessage, type ServerMessage, type Whereabouts } from '../../src/online/protocol.ts';
import { act, campaignInfo, createRoom, joinRoom, toMemberCampaign, memberView, type RoomState } from '../../src/online/room.ts';
import type { Env } from './env.ts';

interface Attachment {
  playerId: string;
  where: Whereabouts;
}

export class CampaignRoom extends DurableObject<Env> {
  private state: RoomState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered without waking the campaign up: keeps phones' connections checked for free.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<RoomState>('state')) ?? null;
    });
  }

  async create(init: Parameters<typeof createRoom>[0]): Promise<void> {
    if (this.state) throw new Error('Campaign already exists');
    this.state = createRoom(init);
    await this.save();
  }

  /** A player connecting: the worker has already checked who they are (X-Player). */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const playerId = request.headers.get('X-Player') ?? '';
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);

    const state = this.state;
    const refusal = state
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
    if (msg.t === 'where') {
      attachment.where = cleanWhere(msg.where);
      ws.serializeAttachment(attachment);
      this.broadcast();
      return;
    }
    const result = act(state, attachment.playerId, msg);
    if (result.error) {
      send(ws, { t: 'error', reason: result.error, id: msg.t === 'result' ? msg.id : undefined });
      this.sendState(ws, attachment.playerId, this.presence()); // undo the player's guess at the outcome
      return;
    }
    await this.save();
    if (msg.t === 'result' && result.report) send(ws, { t: 'report', id: msg.id, report: result.report });
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, 'Bye');
    } catch {
      // already closed
    }
    this.broadcast(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcast(ws);
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
      if (ws !== leaving && attachment) this.sendState(ws, attachment.playerId, presence);
    }
  }

  private sendState(ws: WebSocket, playerId: string, presence: ReadonlyMap<string, Whereabouts>): void {
    const state = this.state;
    if (!state?.members[playerId]) return;
    send(ws, { t: 'state', campaign: campaignInfo(state, playerId, presence), you: toMemberCampaign(memberView(state, playerId)) });
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
    if (scenario >= 1 && scenario <= 999) return { at: 'battle', scenario };
  }
  return { at: 'barracks' };
}
