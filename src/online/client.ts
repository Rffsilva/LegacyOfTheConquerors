// Talking to the online campaign server from the game: signing in with a username and code,
// creating campaigns, and what this device remembers (who you are, your campaigns). The list
// of campaigns is kept in your account too, so any device you sign in on has it.

/** The server's address, set at build time; empty when this build has no online play. */
export const SERVER = String(import.meta.env.VITE_ONLINE_SERVER ?? '').replace(/\/+$/, '');

export interface Session {
  token: string;
  playerId: string;
  /** The username, which other players see. */
  name: string;
  /** Signed in with a username and code (not just a device sign-in from before accounts). */
  account?: boolean;
}

export interface KnownCampaign {
  id: string;
  name: string;
}

/** The server no longer accepts our sign-in (for example, the password changed). */
export class SignedOutError extends Error {}

const SESSION_KEY = 'lotc-online.session.v1';
const CAMPAIGNS_KEY = 'lotc-online.campaigns.v1';

export function loadSession(): Session | null {
  return readJson<Session>(SESSION_KEY);
}

export function forgetSession(): void {
  const session = loadSession();
  // Keep the token so signing in again keeps the same identity; just mark it signed out.
  if (session) writeJson(SESSION_KEY, { ...session, token: '' });
}

/**
 * Signs in with a username and personal code: an existing account if the username is taken
 * (and the code is right), a new one if not. `password` is the online password, which a device
 * that is still signed in doesn't need again. Afterwards, this device and the account share one
 * list of campaigns.
 */
export async function signIn(username: string, code: string, password: string): Promise<Session> {
  const previous = readJson<Session>(SESSION_KEY);
  const body = await post<{ token: string; playerId: string; name: string; campaigns: KnownCampaign[] }>('/api/session', {
    username,
    code,
    password,
    token: previous?.token || readJson<string>(`${SESSION_KEY}.last`) || undefined,
  });
  // Someone else's account on this device: their campaigns aren't ours.
  if (previous?.playerId && previous.playerId !== body.playerId) forgetDevice();
  const session: Session = { token: body.token, playerId: body.playerId, name: body.name, account: true };
  writeJson(SESSION_KEY, session);
  writeJson(`${SESSION_KEY}.last`, body.token);
  await mergeCampaigns(session, body.campaigns);
  return session;
}

/** Fetches the account's campaigns (another device may have added some) and merges them in. */
export async function refreshCampaigns(session: Session): Promise<KnownCampaign[]> {
  try {
    const response = await fetch(`${SERVER}/api/me`, { headers: { Authorization: `Bearer ${session.token}` } });
    if (response.ok) await mergeCampaigns(session, ((await response.json()) as { campaigns: KnownCampaign[] }).campaigns);
  } catch {
    // offline: this device's list will do
  }
  return knownCampaigns();
}

/** Both lists together: the account's, plus any this device knew that the account didn't. */
async function mergeCampaigns(session: Session, account: KnownCampaign[]): Promise<void> {
  const local = knownCampaigns();
  const merged = [...account, ...local.filter((c) => !account.some((a) => a.id === c.id))];
  writeJson(CAMPAIGNS_KEY, merged);
  for (const campaign of local.filter((c) => !account.some((a) => a.id === c.id))) syncCampaign(session, { add: campaign });
}

/**
 * Logs off: this device forgets who you are and your campaigns (they stay in your account and
 * online; sign in again, here or anywhere, to get them back).
 */
export function logOff(): void {
  removeKey(SESSION_KEY);
  removeKey(`${SESSION_KEY}.last`);
  forgetDevice();
}

/** Everything this device kept about online campaigns. */
function forgetDevice(): void {
  removeKey(CAMPAIGNS_KEY);
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('lotc-online.cache.') || key.startsWith('lotc-online.pending.')) localStorage.removeItem(key);
    }
  } catch {
    // nothing stored
  }
}

/** Tells the account about a campaign joined or removed (best effort: the next sign-in merges anyway). */
function syncCampaign(session: Session | null, change: { add?: KnownCampaign; remove?: string }): void {
  if (!session?.account || !session.token) return;
  void fetch(`${SERVER}/api/me/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    body: JSON.stringify(change),
  }).catch(() => undefined);
}

/** Does the server still accept this sign-in? Network trouble counts as yes. */
export async function stillSignedIn(session: Session): Promise<boolean> {
  try {
    const response = await fetch(`${SERVER}/api/session?token=${encodeURIComponent(session.token)}`);
    return response.status !== 401;
  } catch {
    return true;
  }
}

export async function createCampaign(session: Session, name: string, difficulty: number): Promise<{ id: string; invite: string }> {
  return post('/api/campaigns', { name, difficulty, playerName: session.name }, session.token);
}

export function knownCampaigns(): KnownCampaign[] {
  return readJson<KnownCampaign[]>(CAMPAIGNS_KEY) ?? [];
}

export function rememberCampaign(campaign: KnownCampaign): void {
  const known = knownCampaigns();
  const existing = known.find((c) => c.id === campaign.id);
  if (existing?.name === campaign.name) return; // called on every update: only news goes out
  writeJson(CAMPAIGNS_KEY, existing ? known.map((c) => (c.id === campaign.id ? campaign : c)) : [campaign, ...known]);
  syncCampaign(loadSession(), { add: campaign });
}

export function forgetCampaign(id: string): void {
  writeJson(CAMPAIGNS_KEY, knownCampaigns().filter((c) => c.id !== id));
  syncCampaign(loadSession(), { remove: id });
  removeKey(`lotc-online.cache.${id}`);
}

/** A link that opens this game and joins the campaign. */
export function inviteLink(id: string, invite: string): string {
  return `${location.origin}${location.pathname}#join=${id}.${invite}`;
}

/** Reads an invite from a link (or just its #join=… part). */
export function readInvite(text: string): { id: string; invite: string } | null {
  const match = /join=([0-9a-f]{64})\.([0-9a-f]{24})/.exec(text);
  return match ? { id: match[1], invite: match[2] } : null;
}

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${SERVER}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection.');
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (response.status === 401 && token) throw new SignedOutError(data.error ?? 'Please sign in again.');
  if (!response.ok) throw new Error(data.error ?? `The server said no (${response.status}).`);
  return data;
}

export function readJson<T>(key: string): T | null {
  try {
    const json = localStorage.getItem(key);
    return json ? (JSON.parse(json) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable: online play still works, it just forgets more
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing to remove
  }
}
