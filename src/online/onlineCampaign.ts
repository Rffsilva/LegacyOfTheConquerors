// A live connection to one online campaign. Keeps this player's barracks (`view`) and what
// everyone else is doing (`info`) up to date, carries the ready-up lobby and the battle being
// fought, and reconnects after signal drops (rejoining the battle where it left off).

import {
  dismiss,
  hire,
  rename,
  setLeader,
  train,
  type ActionResult,
  type BattleReport,
  type BattleSummary,
  type Campaign,
  type TeamOps,
} from '../game/campaign.ts';
import { readJson, rememberCampaign, SERVER, stillSignedIn, writeJson, type Session } from './client.ts';
import type { Frame } from './lockstep.ts';
import type { BattleMessage } from './onlineBattle.ts';
import { CLOSE_FORBIDDEN, PROTOCOL_VERSION, type CampaignInfo, type ClientMessage, type MemberCampaign, type ServerMessage, type Whereabouts } from './protocol.ts';
import { toData, toGuy } from './room.ts';

export type ConnectionStatus = 'connecting' | 'online' | 'offline' | 'signed-out' | 'refused';

export interface CampaignChange {
  /** This player's barracks changed (not just someone else's whereabouts). */
  view: boolean;
  /** Something to tell the player, like a refused action or a saved battle. */
  notice?: string;
}

type ResultMessage = Extract<ClientMessage, { t: 'result' }>;

interface Cached {
  campaign: CampaignInfo;
  you: MemberCampaign;
}

const MAX_RETRY_MS = 15_000;
/** Phones often don't notice a dead connection; a ping that goes unanswered gives it away. */
const PING_MS = 15_000;
const SILENCE_MS = 35_000;

export class OnlineCampaign {
  readonly id: string;
  /** This player's barracks, as a regular campaign. Updated in place. */
  readonly view: Campaign;
  info: CampaignInfo | null = null;
  status: ConnectionStatus = 'connecting';
  /** Why the server refused us, when status is 'refused'. */
  refusal = '';
  onChange?: (change: CampaignChange) => void;
  /** A battle to play: just started, joined, or sent again after reconnecting. */
  onBattle?: (message: BattleMessage) => void;
  onBattleEnd?: (id: string, reason: string) => void;
  onReport?: (id: string, report: BattleReport) => void;
  /** The battle we're playing, to rejoin after a dropped connection. */
  private following: string | null = null;
  /**
   * Ticks of that battle no one has taken yet: they start coming while the battle screen is
   * still loading, and losing any would make this device's battle drift from everyone else's.
   */
  private ticks: Frame[] = [];
  private tickHandler?: (frames: Frame[]) => void;

  private readonly session: Session;
  private invite: string | null;
  private socket: WebSocket | null = null;
  private retryMs = 1000;
  private retryTimer = 0;
  private pingTimer = 0;
  private lastHeard = 0;
  private closed = false;
  private where: Whereabouts = { at: 'barracks' };
  private readonly wake = () => this.reconnectSoon(0);
  private readonly lostSignal = () => this.socket && this.drop(this.socket);

  constructor(session: Session, id: string, invite: string | null) {
    this.session = session;
    this.id = id;
    this.invite = invite;
    this.view = { version: 1, name: 'Online campaign', money: 0, score: 0, team: [], scenario: 1, completed: [], hired: {}, difficulty: 1, open: [1] };
    const cached = readJson<Cached>(this.cacheKey());
    if (cached) this.applyState(cached.campaign, cached.you);
    window.addEventListener('online', this.wake);
    window.addEventListener('offline', this.lostSignal);
    document.addEventListener('visibilitychange', this.wake);
    this.connect();
  }

  /** Has the barracks been loaded, from the server or from this device's last copy? */
  get loaded(): boolean {
    return this.info !== null;
  }

  readonly team: TeamOps = {
    hire: (guy) => this.change(() => hire(this.view, guy), () => ({ t: 'hire', guy: toData(guy) })),
    train: (index, proposed) => this.change(() => train(this.view, index, proposed), () => ({ t: 'train', index, guy: toData(proposed) })),
    dismiss: (index) => this.change(() => (dismiss(this.view, index), { ok: true }), () => ({ t: 'dismiss', index })),
    setLeader: (index) => this.change(() => (setLeader(this.view, index), { ok: true }), () => ({ t: 'leader', index })),
    rename: (index, name) => this.change(() => rename(this.view, index, name), () => ({ t: 'rename', index, name })),
  };

  /**
   * Puts cash into the campaign bank (a positive amount) or takes it out (negative). Shown here
   * at once; the server checks it and has the last word.
   */
  bank(amount: number): ActionResult {
    const info = this.info;
    const n = Math.trunc(amount);
    if (!info || !n) return { ok: false, reason: 'Choose an amount.' };
    if (n > this.view.money) return { ok: false, reason: `You only have ${this.view.money.toLocaleString('en-US')}.` };
    if (-n > info.bank) return { ok: false, reason: `The bank only has ${info.bank.toLocaleString('en-US')}.` };
    const result = this.change(
      () => {
        this.view.money -= n;
        info.bank += n;
        info.bankLog = [{ name: this.me?.name ?? '', amount: n, at: Date.now() }, ...info.bankLog];
        return { ok: true };
      },
      () => ({ t: 'bank', amount: n }),
    );
    if (result.ok) this.onChange?.({ view: true });
    return result;
  }

  setWhere(where: Whereabouts): void {
    this.where = where;
    this.send({ t: 'where', where });
  }

  /** Our entry in the campaign's player list. */
  get me(): CampaignInfo['members'][number] | undefined {
    return this.info?.members.find((m) => m.you);
  }

  ready(ready: boolean): void {
    this.send({ t: 'ready', ready });
  }

  chooseField(scenario: number): void {
    this.send({ t: 'field', scenario });
  }

  /** Into the battle being fought (or back into it). */
  joinBattle(): void {
    this.send({ t: 'battle-join' });
  }

  /** Hands over the battle's ticks as they come (and any that came before). */
  takeTicks(handler: ((frames: Frame[]) => void) | undefined): void {
    this.tickHandler = handler;
    if (handler && this.ticks.length) handler(this.ticks.splice(0));
  }

  /** Out of the battle: our squad fights on under the computer. */
  leaveBattle(): void {
    this.following = null;
    this.ticks = [];
    this.send({ t: 'battle-leave' });
  }

  /** The arena, at a checkpoint: leave with our rewards, or fight on. */
  arenaChoice(leave: boolean): void {
    this.send({ t: 'arena-choice', leave });
  }

  /** The arena: a player's run is over; the server settles it (the first device to say so wins). */
  arenaDone(id: string, player: number, par: number, summary: BattleSummary): void {
    this.send({ t: 'arena-done', id, player, par, summary });
  }

  sendInput(code: number): void {
    this.send({ t: 'input', code });
  }

  submitBattle(id: string, par: number, summaries: (BattleSummary | null)[]): void {
    this.send({ t: 'battle-result', id, par, summaries });
  }

  close(): void {
    this.closed = true;
    this.onChange = undefined;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pingTimer);
    window.removeEventListener('online', this.wake);
    window.removeEventListener('offline', this.lostSignal);
    document.removeEventListener('visibilitychange', this.wake);
    this.socket?.close(1000, 'Bye');
    this.socket = null;
  }

  // --- Connection --------------------------------------------------------------------

  private connect(): void {
    if (this.closed || this.socket) return;
    const params = new URLSearchParams({ token: this.session.token, name: this.session.name, v: String(PROTOCOL_VERSION) });
    if (this.invite) params.set('invite', this.invite);
    const url = `${SERVER.replace(/^http/, 'ws')}/api/campaigns/${this.id}/connect?${params}`;
    let opened = false;
    const socket = new WebSocket(url);
    this.socket = socket;
    if (this.status !== 'offline') this.setStatus('connecting');

    socket.addEventListener('open', () => {
      opened = true;
      this.retryMs = 1000;
      this.lastHeard = Date.now();
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        if (Date.now() - this.lastHeard > SILENCE_MS) this.drop(socket);
        else if (socket.readyState === WebSocket.OPEN) socket.send('ping');
      }, PING_MS);
      socket.send(JSON.stringify({ t: 'where', where: this.where } satisfies ClientMessage));
      for (const result of this.pending) socket.send(JSON.stringify(result));
      if (this.following) socket.send(JSON.stringify({ t: 'battle-join' } satisfies ClientMessage));
    });
    socket.addEventListener('message', (event) => {
      this.lastHeard = Date.now();
      if (event.data === 'pong') return;
      try {
        this.receive(JSON.parse(String(event.data)) as ServerMessage);
      } catch {
        // ignore anything we can't read
      }
    });
    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      window.clearInterval(this.pingTimer);
      if (this.closed) return;
      if (event.code === CLOSE_FORBIDDEN) return; // receive() already took the refusal
      // Never got in: maybe our sign-in has expired rather than the network being down.
      if (!opened) {
        void stillSignedIn(this.session).then((ok) => {
          if (this.closed) return;
          if (ok) this.reconnectSoon();
          else this.setStatus('signed-out');
        });
        this.setStatus('offline');
        return;
      }
      this.setStatus('offline');
      this.reconnectSoon();
    });
  }

  /** Gives up on a connection that has gone quiet, without waiting for the browser to agree. */
  private drop(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    window.clearInterval(this.pingTimer);
    socket.close();
    this.setStatus('offline');
    this.reconnectSoon();
  }

  private reconnectSoon(delay = this.retryMs): void {
    if (this.closed || this.socket || this.status === 'refused' || this.status === 'signed-out') return;
    if (document.visibilityState === 'hidden' && delay === 0) return;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
    this.retryMs = Math.min(MAX_RETRY_MS, this.retryMs * 2);
  }

  private receive(msg: ServerMessage): void {
    if (msg.t === 'state') {
      this.invite = null; // we're a member now
      const before = JSON.stringify(this.viewData());
      this.applyState(msg.campaign, msg.you);
      writeJson(this.cacheKey(), { campaign: msg.campaign, you: msg.you } satisfies Cached);
      rememberCampaign({ id: this.id, name: msg.campaign.name });
      const viewChanged = JSON.stringify(this.viewData()) !== before;
      // The battle we were in is gone (say, the server restarted while we were away).
      const following = this.following;
      if (following && msg.campaign.battle?.id !== following) {
        this.following = null;
        this.ticks = [];
        this.onBattleEnd?.(following, 'The battle was interrupted.');
      }
      this.setStatus('online', { view: viewChanged });
    } else if (msg.t === 'battle') {
      if (this.following !== msg.setup.id) this.ticks = [];
      this.following = msg.setup.id;
      this.onBattle?.(msg);
    } else if (msg.t === 'ticks') {
      if (!this.following) return;
      if (this.tickHandler) this.tickHandler(msg.frames);
      else this.ticks.push(...msg.frames);
    } else if (msg.t === 'battle-end') {
      if (this.following === msg.id) this.following = null;
      this.onBattleEnd?.(msg.id, msg.reason);
    } else if (msg.t === 'report') {
      this.settle(msg.id);
      if (this.onReport) this.onReport(msg.id, msg.report);
      else this.onChange?.({ view: false, notice: 'Battle result saved.' });
    } else if (msg.t === 'error') {
      if (msg.id) this.settle(msg.id);
      if (msg.fatal) {
        this.refusal = msg.reason;
        this.setStatus('refused');
      } else {
        this.onChange?.({ view: false, notice: msg.reason });
      }
    }
  }

  private applyState(campaign: CampaignInfo, you: MemberCampaign): void {
    // (A copy saved on this device by an older version has no bank.)
    this.info = { ...campaign, bank: campaign.bank ?? 0, bankLog: campaign.bankLog ?? [] };
    Object.assign(this.view, {
      name: campaign.name,
      difficulty: campaign.difficulty,
      open: campaign.open,
      money: you.money,
      score: you.score,
      team: you.team.map(toGuy),
      scenario: you.scenario,
      completed: [...you.completed],
      hired: { ...you.hired },
    });
  }

  private viewData(): unknown {
    const v = this.view;
    return [v.money, v.score, v.team.map(toData), v.scenario, v.completed, v.hired, v.open];
  }

  private setStatus(status: ConnectionStatus, change: CampaignChange = { view: false }): void {
    this.status = status;
    this.onChange?.(change);
  }

  /** Applies a team change here at once, and sends it; the server's answer has the last word. */
  private change(local: () => ActionResult, message: () => ClientMessage): ActionResult {
    if (this.status !== 'online') return { ok: false, reason: 'Not connected right now. Team changes need a connection.' };
    if (this.me?.inBattle) return { ok: false, reason: 'Your squad is in battle. Changes wait until it ends.' };
    const result = local();
    if (result.ok) this.send(message());
    return result;
  }

  private send(msg: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  // --- Results waiting for the server ---------------------------------------------------

  private get pending(): ResultMessage[] {
    return readJson<ResultMessage[]>(this.pendingKey()) ?? [];
  }

  private set pending(results: ResultMessage[]) {
    writeJson(this.pendingKey(), results);
  }

  private settle(id: string): void {
    this.pending = this.pending.filter((r) => r.id !== id);
  }

  /** Battles fought but not yet confirmed by the server. */
  get unsent(): number {
    return this.pending.length;
  }

  private cacheKey(): string {
    return `lotc-online.cache.${this.id}`;
  }

  private pendingKey(): string {
    return `lotc-online.pending.${this.id}`;
  }
}
