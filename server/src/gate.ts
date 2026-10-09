// The one place that knows the signing secret: checks the access password, hands out sign-in
// tokens and slows down password guessing.

import { DurableObject } from 'cloudflare:workers';
import { makeToken, passwordVersion, randomHex, readToken, samePassword, signingKey } from './auth.ts';
import type { Env } from './env.ts';

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60_000;

export type LoginResult = { ok: true; token: string; playerId: string } | { ok: false; status: number; error: string };

export class Gate extends DurableObject<Env> {
  private keys: { key: CryptoKey; version: string } | null = null;
  private readonly failures = new Map<string, { count: number; since: number }>();

  /** Signs a player in with the access password, keeping their id if they had a valid token. */
  async login(password: unknown, ip: string, previous: unknown): Promise<LoginResult> {
    const actual = this.env.ACCESS_PASSWORD;
    if (!actual) return { ok: false, status: 503, error: 'Online play is not set up yet: the server has no password.' };
    const now = Date.now();
    const record = this.failures.get(ip);
    if (record && now - record.since > LOCKOUT_MS) this.failures.delete(ip);
    if ((this.failures.get(ip)?.count ?? 0) >= MAX_FAILURES) {
      return { ok: false, status: 429, error: 'Too many wrong passwords. Try again in a few minutes.' };
    }
    if (!(await samePassword(password, actual))) {
      const failed = this.failures.get(ip) ?? { count: 0, since: now };
      failed.count++;
      this.failures.set(ip, failed);
      return { ok: false, status: 401, error: 'Wrong password.' };
    }
    this.failures.delete(ip);
    const { key, version } = await this.signingKeys();
    // Someone signing in again (say, after a password change) stays the same player.
    const playerId = (await readToken(key, previous))?.playerId ?? randomHex(16);
    return { ok: true, token: await makeToken(key, playerId, version), playerId };
  }

  /** The player a token belongs to, or null (also when the password has changed since). */
  async verify(token: unknown): Promise<string | null> {
    if (!this.env.ACCESS_PASSWORD) return null;
    const { key, version } = await this.signingKeys();
    const read = await readToken(key, token);
    return read?.version === version ? read.playerId : null;
  }

  private async signingKeys(): Promise<{ key: CryptoKey; version: string }> {
    if (!this.keys) {
      let secret = await this.ctx.storage.get<string>('secret');
      if (!secret) {
        secret = randomHex(32);
        await this.ctx.storage.put('secret', secret);
      }
      this.keys = { key: await signingKey(secret), version: await passwordVersion(secret, this.env.ACCESS_PASSWORD ?? '') };
    }
    return this.keys;
  }
}
