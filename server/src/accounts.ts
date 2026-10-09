// Player accounts: a username and a personal code, so a player is the same person (with the
// same campaigns) on any device. Codes are kept only as a slow, salted hash.

export interface Account {
  /** The username as typed when it was created, shown to friends. */
  name: string;
  playerId: string;
  salt: string;
  hash: string;
  created: number;
  /** The online campaigns this player is in, so any device can list them. */
  campaigns: { id: string; name: string }[];
}

const encoder = new TextEncoder();
const ITERATIONS = 100_000;
export const MAX_CAMPAIGNS = 50;

/** The key a username is stored under: case and spacing don't matter. */
export function usernameKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Why a username can't be used, or null if it's fine. */
export function checkUsername(name: unknown): string | null {
  if (typeof name !== 'string') return 'Choose a username.';
  const clean = name.normalize('NFKC').trim();
  if (clean.length < 2 || clean.length > 20) return 'Usernames are 2 to 20 characters long.';
  if (!/^[\p{L}\p{N} ._-]+$/u.test(clean)) return 'Usernames can have letters, numbers, spaces, dots, dashes and underscores.';
  return null;
}

/** Why a personal code can't be used, or null if it's fine. */
export function checkCode(code: unknown): string | null {
  if (typeof code !== 'string' || code.length < 4) return 'Your code needs at least 4 characters.';
  if (code.length > 64) return 'Your code can be at most 64 characters.';
  return null;
}

export async function hashCode(code: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: ITERATIONS }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compares a typed code with an account's, in constant time. */
export async function sameCode(account: Account, code: string): Promise<boolean> {
  const given = await hashCode(code, account.salt);
  let diff = given.length ^ account.hash.length;
  for (let i = 0; i < Math.min(given.length, account.hash.length); i++) diff |= given.charCodeAt(i) ^ account.hash.charCodeAt(i);
  return diff === 0;
}

/** Adds or renames a campaign in the account's list (newest first), or removes one. */
export function updateCampaigns(account: Account, change: { add?: { id: string; name: string }; remove?: string }): void {
  if (change.remove) account.campaigns = account.campaigns.filter((c) => c.id !== change.remove);
  const add = change.add;
  if (add && /^[0-9a-f]{64}$/.test(add.id)) {
    const name = String(add.name ?? '').slice(0, 24) || 'Online campaign';
    account.campaigns = [{ id: add.id, name }, ...account.campaigns.filter((c) => c.id !== add.id)].slice(0, MAX_CAMPAIGNS);
  }
}
