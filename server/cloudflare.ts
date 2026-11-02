// Cloudflare Workers: static files come from ./dist (wrangler.jsonc › assets); /api/live/<group> goes to that
// group's Durable Object, everything else to the API.
import { DurableObject } from 'cloudflare:workers';
import { app, type Env as ApiEnv } from './app';
import { Room, SCHEMA, sqlStorage, type Conn, type ConnMeta } from './room';
import { GROUP_RE } from '../shared/live';

interface Env extends ApiEnv {
  ROOMS: DurableObjectNamespace<LiveRoom>;
}

export default {
  fetch(req, env, ctx) {
    const m = new URL(req.url).pathname.match(/^\/api\/live\/([^/]+)$/);
    if (m) {
      if (!GROUP_RE.test(m[1])) return new Response('onbekende groep', { status: 404 });
      return env.ROOMS.get(env.ROOMS.idFromName(m[1]), { locationHint: 'weur' }).fetch(req);
    }
    return app.fetch(req, env, ctx);
  },
} satisfies ExportedHandler<Env>;

/** One instance per group. WebSocket hibernation: costs nothing while nobody sends anything. */
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
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket verwacht', { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
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
