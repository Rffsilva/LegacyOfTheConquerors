// The online campaign server for Legacy of the Conquerors (a Cloudflare Worker).
//
//   POST /api/session                  { password, token? } -> { token, playerId }
//   GET  /api/session?token=           -> { playerId }, or 401 when the token no longer works
//   POST /api/campaigns                { name, difficulty, playerName } -> { id, invite }   (signed in)
//   GET  /api/campaigns/:id/connect    WebSocket: ?token=&name=&invite=

import { randomHex } from './auth.ts';
import type { Env } from './env.ts';

export { CampaignRoom } from './campaignRoom.ts';
export { Gate } from './gate.ts';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const allowed = isAllowedOrigin(origin, env);
    const respond = (body: unknown, status = 200) => withCors(Response.json(body, { status }), allowed ? origin : null);
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), allowed ? origin : null);
    // Only the game's own pages may use the server from a browser.
    if (origin && !allowed) return new Response('Forbidden', { status: 403 });

    const url = new URL(request.url);
    const gate = env.GATE.get(env.GATE.idFromName('gate'));
    try {
      if (url.pathname === '/') return new Response('Legacy of the Conquerors online server\n');

      if (url.pathname === '/api/session' && request.method === 'POST') {
        const body = await readJson(request);
        const result = await gate.login(body.password, request.headers.get('CF-Connecting-IP') ?? 'unknown', body.token);
        return result.ok ? respond({ token: result.token, playerId: result.playerId }) : respond({ error: result.error }, result.status);
      }

      if (url.pathname === '/api/session' && request.method === 'GET') {
        const playerId = await gate.verify(url.searchParams.get('token'));
        return playerId ? respond({ playerId }) : respond({ error: 'Please sign in again.' }, 401);
      }

      if (url.pathname === '/api/campaigns' && request.method === 'POST') {
        const playerId = await gate.verify(request.headers.get('Authorization')?.replace(/^Bearer /, ''));
        if (!playerId) return respond({ error: 'Please sign in again.' }, 401);
        const body = await readJson(request);
        const id = env.ROOMS.newUniqueId();
        const invite = randomHex(12);
        await env.ROOMS.get(id).create({
          id: id.toString(),
          name: String(body.name ?? ''),
          difficulty: Number(body.difficulty ?? 1),
          invite,
          owner: playerId,
          ownerName: String(body.playerName ?? ''),
          now: Date.now(),
        });
        return respond({ id: id.toString(), invite });
      }

      const connect = /^\/api\/campaigns\/([0-9a-f]{64})\/connect$/.exec(url.pathname);
      if (connect && request.method === 'GET') {
        if (request.headers.get('Upgrade') !== 'websocket') return respond({ error: 'Expected a WebSocket.' }, 426);
        const playerId = await gate.verify(url.searchParams.get('token'));
        if (!playerId) return respond({ error: 'Please sign in again.' }, 401);
        const headers = new Headers(request.headers);
        headers.set('X-Player', playerId);
        return env.ROOMS.get(env.ROOMS.idFromString(connect[1])).fetch(new Request(request.url, { headers }));
      }

      return respond({ error: 'Not found.' }, 404);
    } catch (error) {
      console.error(error);
      return respond({ error: 'Something went wrong on the server.' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

function isAllowedOrigin(origin: string | null, env: Env): boolean {
  return origin !== null && env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).includes(origin);
}

function withCors(response: Response, origin: string | null): Response {
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Vary', 'Origin');
  return new Response(response.body, { status: response.status, headers });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
