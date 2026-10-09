// The one place that knows the signing secret and the accounts: checks the access password and
// players' usernames and codes, hands out sign-in tokens and slows down guessing.

import { DurableObject } from 'cloudflare:workers';
import { checkCode, checkUsername, hashCode, sameCode, updateCampaigns, usernameKey, type Account } from './accounts.ts';
import { makeToken, passwordVersion, randomHex, readToken, samePassword, signingKey } from './auth.ts';
import type { Env } from './env.ts';

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60_000;

export interface Profile {
  name: string;
  campaigns: Account['campaigns'];
}

export type LoginResult = ({ ok: true; token: string; playerId: string } & Profile) | { ok: false; status: number; error: string };

export interface LoginRequest {
  username: unknown;
  code: unknown;
  /** The online password: not needed again on a device that is still signed in. */
  password: unknown;
  /** The device's current sign-in, if any. */
  token: unknown;
  ip: string;
}

/** Counts failed attempts per key (an address, a username) and locks a key out for a while. */
class Limiter {
  private readonly failures = new Map<string, { count: number; since: number }>();

  locked(key: string, now: number): boolean {
    const record = this.failures.get(key);
    if (record && now - record.since > LOCKOUT_MS) this.failures.delete(key);
    return (this.failures.get(key)?.count ?? 0) >= MAX_FAILURES;
  }

  fail(key: string, now: number): void {
    const record = this.failures.get(key) ?? { count: 0, since: now };
    record.count++;
    this.failures.set(key, record);
  }

  clear(key: string): void {
    this.failures.delete(key);
  }
}

export class Gate extends DurableObject<Env> {
  private keys: { key: CryptoKey; version: string } | null = null;
  private readonly passwords = new Limiter();
  private readonly codes = new Limiter();

  /**
   * Signs a player in with their username and code: the account's player if the username is
   * taken (and the code is right), or a new account if not. A new account keeps the identity of
   * the device's current sign-in, so players from before accounts keep their campaigns.
   */
  async login(request: LoginRequest): Promise<LoginResult> {
    const actual = this.env.ACCESS_PASSWORD;
    if (!actual) return { ok: false, status: 503, error: 'Online play is not set up yet: the server has no password.' };
    const now = Date.now();
    const { key, version } = await this.signingKeys();
    const current = await readToken(key, request.token);

    // Only invited players: the online password, unless this device is already signed in.
    if (current?.version !== version) {
      if (this.passwords.locked(request.ip, now)) return { ok: false, status: 429, error: 'Too many wrong passwords. Try again in a few minutes.' };
      if (typeof request.password !== 'string' || !request.password) return { ok: false, status: 401, error: 'Enter the online password.' };
      if (!(await samePassword(request.password, actual))) {
        this.passwords.fail(request.ip, now);
        return { ok: false, status: 401, error: 'Wrong online password.' };
      }
      this.passwords.clear(request.ip);
    }

    const problem = checkUsername(request.username) ?? checkCode(request.code);
    if (problem) return { ok: false, status: 400, error: problem };
    const username = (request.username as string).normalize('NFKC').trim().replace(/\s+/g, ' ');
    const code = request.code as string;
    const userKey = usernameKey(username);
    if (this.codes.locked(userKey, now)) return { ok: false, status: 429, error: 'Too many wrong codes for this username. Try again in a few minutes.' };

    let account = await this.ctx.storage.get<Account>(`account:${userKey}`);
    if (account) {
      if (!(await sameCode(account, code))) {
        this.codes.fail(userKey, now);
        return { ok: false, status: 401, error: 'Wrong code for this username. (New here? Pick a different username.)' };
      }
      this.codes.clear(userKey);
    } else {
      // This device's identity, unless it already belongs to another account.
      const previous = current && !(await this.ctx.storage.get(`player:${current.playerId}`)) ? current.playerId : null;
      const salt = randomHex(16);
      account = { name: username, playerId: previous ?? randomHex(16), salt, hash: await hashCode(code, salt), created: now, campaigns: [] };
      await this.ctx.storage.put({ [`account:${userKey}`]: account, [`player:${account.playerId}`]: userKey });
    }
    return {
      ok: true,
      token: await makeToken(key, account.playerId, version),
      playerId: account.playerId,
      name: account.name,
      campaigns: account.campaigns,
    };
  }

  /** The player a token belongs to, or null (also when the password has changed since). */
  async verify(token: unknown): Promise<string | null> {
    if (!this.env.ACCESS_PASSWORD) return null;
    const { key, version } = await this.signingKeys();
    const read = await readToken(key, token);
    return read?.version === version ? read.playerId : null;
  }

  /** A signed-in player's name and campaigns (null for a player from before accounts). */
  async profile(playerId: string): Promise<Profile | null> {
    const account = await this.accountOf(playerId);
    return account && { name: account.name, campaigns: account.campaigns };
  }

  async changeCampaigns(playerId: string, change: Parameters<typeof updateCampaigns>[1]): Promise<Profile | null> {
    const found = await this.accountOf(playerId);
    if (!found) return null;
    updateCampaigns(found, change);
    await this.ctx.storage.put(`account:${usernameKey(found.name)}`, found);
    return { name: found.name, campaigns: found.campaigns };
  }

  private async accountOf(playerId: string): Promise<Account | null> {
    const userKey = await this.ctx.storage.get<string>(`player:${playerId}`);
    return (userKey && (await this.ctx.storage.get<Account>(`account:${userKey}`))) || null;
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
