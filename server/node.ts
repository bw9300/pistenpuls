// Node: serves the API, live (WebSocket) and (after `npm run build`) the frontend from ./dist. Works on any host that runs Node 22.13+.
// Environment: WINDY_KEY (from .env or the host), PORT (default 8787), DATA_DIR (default ./data, holds the SQLite file).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { WebSocketServer, WebSocket } from 'ws';
import { app as api, type Env } from './app';
import { Room, SCHEMA, sqlStorage, type Conn, type ConnMeta } from './room';
import { GROUP_RE } from '../shared/live';

const env: Env = { WINDY_KEY: process.env.WINDY_KEY };
const port = Number(process.env.PORT) || 8787;

const root = new Hono();
root.all('/api/*', (c) => api.fetch(c.req.raw, env));
root.use('/*', serveStatic({ root: './dist' }));
const server = serve({ fetch: root.fetch, port }, () => console.log(`Pistenpuls op http://localhost:${port}`));

// ---------- live ----------
const dataDir = process.env.DATA_DIR || 'data';
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'pistenpuls.db'));
for (const q of SCHEMA) db.exec(q);
const sql = {
  all: (q: string, ...p: any[]) => db.prepare(q).all(...p) as any[],
  run: (q: string, ...p: any[]) => void db.prepare(q).run(...p),
};

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

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const m = (req.url || '').match(/^\/api\/live\/([^/?]+)/);
  if (!m || !GROUP_RE.test(m[1])) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    const r = getRoom(m[1]);
    let meta: ConnMeta | null = null;
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
      if (!r.conns.size) rooms.delete(m[1]);
    });
  });
});
