// Sign-in tokens: "<player id>.<password version>.<signature>", signed with the server's own
// secret. The password version is a short hash of the access password: when the password
// changes, old tokens stop working, but a player who signs in again keeps their identity (and
// so their place in their campaigns).

const encoder = new TextEncoder();

export async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function passwordVersion(secret: string, password: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${secret}\n${password}`));
  return [...new Uint8Array(digest).slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function makeToken(key: CryptoKey, playerId: string, version: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${playerId}.${version}`));
  return `${playerId}.${version}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Who a token belongs to and the password version it was issued under, or null if it isn't ours. */
export async function readToken(key: CryptoKey, token: unknown): Promise<{ playerId: string; version: string } | null> {
  if (typeof token !== 'string') return null;
  const [playerId, version, signature, extra] = token.split('.');
  if (!playerId || !version || !signature || extra !== undefined || !/^[0-9a-f]{32}$/.test(playerId)) return null;
  const bytes = fromBase64Url(signature);
  if (!bytes) return null;
  const valid = await crypto.subtle.verify('HMAC', key, bytes, encoder.encode(`${playerId}.${version}`));
  return valid ? { playerId, version } : null;
}

/** Compares a typed password with the real one without leaking how much of it matched. */
export async function samePassword(given: unknown, actual: string): Promise<boolean> {
  if (typeof given !== 'string') return false;
  const [a, b] = await Promise.all([given, actual].map((s) => crypto.subtle.digest('SHA-256', encoder.encode(s))));
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** A random hex string, for player ids, invite codes and the signing secret. */
export function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
