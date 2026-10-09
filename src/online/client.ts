// Talking to the online campaign server from the game: signing in, creating campaigns, and
// what this device remembers (who you are, which campaigns you're in, invite links).

/** The server's address, set at build time; empty when this build has no online play. */
export const SERVER = String(import.meta.env.VITE_ONLINE_SERVER ?? '').replace(/\/+$/, '');

export interface Session {
  token: string;
  playerId: string;
  /** The name other players see. */
  name: string;
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

/** Signs in with the access password; signing in again keeps the same player identity. */
export async function signIn(password: string, name: string): Promise<Session> {
  const previous = readJson<Session>(SESSION_KEY);
  const body = await post<{ token: string; playerId: string }>('/api/session', { password, token: previous?.token || previousToken() });
  const session = { token: body.token, playerId: body.playerId, name };
  writeJson(SESSION_KEY, session);
  writeJson(`${SESSION_KEY}.last`, body.token);
  return session;
}

/** The last token this device had, kept after signing out so identity survives. */
function previousToken(): string | undefined {
  return readJson<string>(`${SESSION_KEY}.last`) ?? undefined;
}

export function rename(name: string): void {
  const session = loadSession();
  if (session) writeJson(SESSION_KEY, { ...session, name });
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
  const others = knownCampaigns().filter((c) => c.id !== campaign.id);
  writeJson(CAMPAIGNS_KEY, [campaign, ...others]);
}

export function forgetCampaign(id: string): void {
  writeJson(CAMPAIGNS_KEY, knownCampaigns().filter((c) => c.id !== id));
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
