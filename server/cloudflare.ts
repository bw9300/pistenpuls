// Cloudflare Workers: static files come from ./dist (wrangler.jsonc › assets); /api/live/<trip> goes to that
// trip's Durable Object (after checking the session and membership), everything else to the API.
import { DurableObject } from 'cloudflare:workers';
import { createApp, sessionFromCookieHeader, type Env as ApiEnv } from './app';
import { directory, type Db, type Directory } from './directory';
import { Room, SCHEMA, sqlStorage, type Conn, type ConnMeta } from './room';
import { roomFor } from '../shared/live';

interface Env extends ApiEnv {
  ROOMS: DurableObjectNamespace<LiveRoom>;
  DB: D1Database;
}

// one Directory per database binding and isolate (so the schema check runs once)
const dirs = new WeakMap<D1Database, Directory>();
function dir(env: Env) {
  let d = dirs.get(env.DB);
  if (!d) {
    const db: Db = {
      all: async (q, ...p) => (await env.DB.prepare(q).bind(...p).all()).results as any[],
      run: async (q, ...p) => void (await env.DB.prepare(q).bind(...p).run()),
    };
    dirs.set(env.DB, (d = directory(db)));
  }
  return d;
}

const room = (env: Env, name: string) => env.ROOMS.get(env.ROOMS.idFromName(name), { locationHint: 'weur' });

const app = createApp<Env>({
  dir,
  presence: async (env, name) => (await room(env, name).fetch('https://room/presence')).json(),
});

export default {
  async fetch(req, env, ctx) {
    const m = new URL(req.url).pathname.match(/^\/api\/live\/([a-z0-9]{1,20})$/);
    if (m) {
      // only signed-in members of this trip get through; the room trusts the identity we pass on
      const user = await dir(env).sessionUser(sessionFromCookieHeader(req.headers.get('Cookie')));
      if (!user) return new Response('niet ingelogd', { status: 401 });
      if (!(await dir(env).isMember(user.id, m[1]))) return new Response('geen lid van deze reis', { status: 403 });
      ctx.waitUntil(dir(env).seen(user.id));
      const headers = new Headers(req.headers);
      headers.set('x-pp-id', user.id);
      headers.set('x-pp-naam', encodeURIComponent(user.naam));
      headers.set('x-pp-trip', m[1]);
      return room(env, roomFor(m[1])).fetch(new Request(req, { headers }));
    }
    return app.fetch(req, env, ctx);
  },
} satisfies ExportedHandler<Env>;

/** One instance per trip. WebSocket hibernation: costs nothing while nobody sends anything. */
export class LiveRoom extends DurableObject<Env> {
  private room: Room;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    for (const q of SCHEMA) sql.exec(q);
    const storage = sqlStorage('', {
      all: (q, ...p) => sql.exec(q, ...p).toArray(),
      run: (q, ...p) => void sql.exec(q, ...p),
    });
    this.room = new Room({
      connections: () => ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN).map(conn),
      storage,
    });
    // keep-alive pings are answered without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req: Request) {
    if (new URL(req.url).pathname === '/presence') return Response.json(this.room.presence());
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket verwacht', { status: 426 });
    const id = req.headers.get('x-pp-id'), naam = decodeURIComponent(req.headers.get('x-pp-naam') || ''), trip = req.headers.get('x-pp-trip');
    if (!id || !naam || !trip) return new Response('onbekende gebruiker', { status: 401 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id, naam, trip, viewing: { trip: null, visible: false }, ready: false } satisfies ConnMeta);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    if (typeof msg === 'string') this.room.onMessage(conn(ws), msg);
  }

  webSocketClose(ws: WebSocket) {
    this.room.onClose(conn(ws));
  }

  webSocketError(ws: WebSocket) {
    this.room.onClose(conn(ws));
  }
}

// the user's details live on the socket itself, so they survive hibernation
const conn = (ws: WebSocket): Conn => ({
  send: (d) => ws.send(d),
  getMeta: () => ws.deserializeAttachment() as ConnMeta | null,
  setMeta: (m) => ws.serializeAttachment(m),
});
