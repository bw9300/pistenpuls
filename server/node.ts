// Node: serves the API, live (WebSocket) and (after `npm run build`) the frontend from ./dist. Works on any host that runs Node 22.13+.
// Environment: WINDY_KEY (from .env or the host), PORT (default 8787), DATA_DIR (default ./data, holds the SQLite file).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { WebSocketServer, WebSocket } from 'ws';
import { createApp, sessionFromCookieHeader, type Env } from './app';
import { directory } from './directory';
import { Room, SCHEMA, sqlStorage, type Conn, type ConnMeta } from './room';
import { roomFor } from '../shared/live';

const env: Env = { WINDY_KEY: process.env.WINDY_KEY };
const port = Number(process.env.PORT) || 8787;

// ---------- one SQLite file for accounts and all rooms ----------
const dataDir = process.env.DATA_DIR || 'data';
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'pistenpuls.db'));
for (const q of SCHEMA) db.exec(q);
const sql = {
  all: (q: string, ...p: any[]) => db.prepare(q).all(...p) as any[],
  run: (q: string, ...p: any[]) => void db.prepare(q).run(...p),
};
const dir = directory({ all: async (q, ...p) => sql.all(q, ...p), run: async (q, ...p) => sql.run(q, ...p) });

// ---------- rooms (in memory while someone is connected) ----------
const rooms = new Map<string, { room: Room; conns: Set<Conn & { ws: WebSocket }> }>();
function getRoom(name: string) {
  let r = rooms.get(name);
  if (!r) {
    const conns = new Set<Conn & { ws: WebSocket }>();
    r = { conns, room: new Room({ connections: () => [...conns], storage: sqlStorage(name, sql) }) };
    rooms.set(name, r);
  }
  return r;
}

// ---------- http ----------
const api = createApp<Env>({
  dir: () => dir,
  presence: async (_env, name) => rooms.get(name)?.room.presence() ?? [],
});
const root = new Hono();
root.all('/api/*', (c) => api.fetch(c.req.raw, env));
root.use('/*', serveStatic({ root: './dist' }));
const server = serve({ fetch: root.fetch, port }, () => console.log(`Pistenpuls op http://localhost:${port}`));

// ---------- live: only signed-in members of the trip get through ----------
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', async (req, socket, head) => {
  const m = (req.url || '').match(/^\/api\/live\/([a-z0-9]{1,20})(?:\?|$)/);
  const deny = (code: number, text: string) => { socket.write(`HTTP/1.1 ${code} ${text}\r\n\r\n`); socket.destroy(); };
  if (!m) return deny(404, 'Not Found');
  const user = await dir.sessionUser(sessionFromCookieHeader(req.headers.cookie)).catch(() => null);
  if (!user) return deny(401, 'Unauthorized');
  if (!(await dir.isMember(user.id, m[1]))) return deny(403, 'Forbidden');
  void dir.seen(user.id);
  wss.handleUpgrade(req, socket, head, (ws) => {
    const name = roomFor(m[1]), r = getRoom(name);
    let meta: ConnMeta | null = { id: user.id, naam: user.naam, trip: m[1], viewing: { trip: null, visible: false }, ready: false };
    const conn = { ws, send: (d: string) => ws.send(d), getMeta: () => meta, setMeta: (x: ConnMeta) => { meta = x; } };
    r.conns.add(conn);
    ws.on('message', (data) => {
      const s = data.toString();
      if (s === 'ping') return ws.send('pong');
      r.room.onMessage(conn, s);
    });
    ws.on('close', () => {
      r.conns.delete(conn);
      r.room.onClose(conn);
      if (!r.conns.size) rooms.delete(name);
    });
  });
});
