// One room per group: who is online, who was here when, and the messages.
// No platform code: cloudflare.ts (Durable Object) and node.ts (ws) provide the connections and the storage.
import { HISTORY, MAX_NAME, MAX_TEXT, RECENT_MS, type ChatMessage, type ClientMsg, type Member, type OnlineMember, type ServerMsg, type Viewing } from '../shared/live.ts';

/** what a connection knows about its user once it said hello */
export interface ConnMeta {
  id: string;
  naam: string;
  viewing: Viewing;
}

export interface Conn {
  send(data: string): void;
  getMeta(): ConnMeta | null;
  setMeta(meta: ConnMeta): void;
}

/** synchronous on purpose: both SQLite in a Durable Object and node:sqlite are */
export interface RoomStorage {
  /** members seen within RECENT_MS (online ones included) */
  members(): Member[];
  saveMember(m: Member): void;
  messages(limit: number): ChatMessage[];
  addMessage(m: Omit<ChatMessage, 'id'>): ChatMessage;
}

export interface RoomHost {
  /** all open connections of this room (including ones that haven't said hello yet) */
  connections(): Conn[];
  storage: RoomStorage;
}

const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

export class Room {
  constructor(private host: RoomHost) {}

  onMessage(conn: Conn, raw: string) {
    let m: ClientMsg;
    try { m = JSON.parse(raw); } catch { return; }
    const me = conn.getMeta();

    if (m.t === 'hello') {
      const id = clean(m.id, 40), naam = clean(m.naam, MAX_NAME);
      if (!id || !naam) return this.send(conn, { t: 'error', error: 'naam en id zijn verplicht' });
      conn.setMeta({ id, naam, viewing: this.viewing(m.viewing) });
      this.host.storage.saveMember({ id, naam, lastSeen: Date.now() });
      this.send(conn, { t: 'state', online: this.online(), members: this.host.storage.members(), messages: this.host.storage.messages(HISTORY) });
      this.broadcastPresence();
      return;
    }
    if (!me) return; // everything else needs a hello first

    if (m.t === 'view') {
      conn.setMeta({ ...me, viewing: this.viewing(m.viewing) });
      this.broadcastPresence();
    } else if (m.t === 'msg') {
      const text = clean(m.text, MAX_TEXT);
      if (!text) return;
      const msg = this.host.storage.addMessage({ from: me.id, naam: me.naam, text, ts: Date.now() });
      this.broadcast({ t: 'msg', msg });
    }
  }

  /** call after the connection is gone (it must no longer be in connections()) */
  onClose(conn: Conn) {
    const me = conn.getMeta();
    if (!me) return;
    // still online in another tab? then 'last seen' is now anyway, harmless
    this.host.storage.saveMember({ id: me.id, naam: me.naam, lastSeen: Date.now() });
    this.broadcastPresence();
  }

  private viewing(v: unknown): Viewing {
    const o = (v && typeof v === 'object' ? v : {}) as Partial<Viewing>;
    return { trip: o.trip ? clean(o.trip, 40) : null, visible: o.visible !== false };
  }

  /** one entry per person, also with several tabs open; visible wins */
  private online(): OnlineMember[] {
    const by = new Map<string, OnlineMember>();
    for (const c of this.host.connections()) {
      const m = c.getMeta();
      if (!m) continue;
      const prev = by.get(m.id);
      if (!prev || (!prev.viewing.visible && m.viewing.visible)) by.set(m.id, { id: m.id, naam: m.naam, viewing: m.viewing });
    }
    return [...by.values()];
  }

  private broadcastPresence() {
    this.broadcast({ t: 'presence', online: this.online(), members: this.host.storage.members() });
  }

  private broadcast(msg: ServerMsg) {
    const data = JSON.stringify(msg);
    for (const c of this.host.connections()) if (c.getMeta()) try { c.send(data); } catch {}
  }

  private send(conn: Conn, msg: ServerMsg) {
    try { conn.send(JSON.stringify(msg)); } catch {}
  }
}

/** SQL shared by both adapters (one database per room on Cloudflare, one file with a room column on Node) */
export const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS members (room TEXT NOT NULL, id TEXT NOT NULL, naam TEXT NOT NULL, last_seen INTEGER NOT NULL, PRIMARY KEY (room, id))',
  'CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, author TEXT NOT NULL, naam TEXT NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS messages_room ON messages (room, id)',
];

/** RoomStorage on any SQLite with a run/all style API */
export function sqlStorage(room: string, sql: { all(q: string, ...p: unknown[]): any[]; run(q: string, ...p: unknown[]): void }): RoomStorage {
  return {
    members: () =>
      sql.all('SELECT id, naam, last_seen FROM members WHERE room = ? AND last_seen > ? ORDER BY last_seen DESC', room, Date.now() - RECENT_MS)
        .map((r) => ({ id: r.id, naam: r.naam, lastSeen: Number(r.last_seen) })),
    saveMember: (m) =>
      sql.run('INSERT INTO members (room, id, naam, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT (room, id) DO UPDATE SET naam = excluded.naam, last_seen = excluded.last_seen', room, m.id, m.naam, m.lastSeen),
    messages: (limit) =>
      sql.all('SELECT id, author, naam, text, ts FROM messages WHERE room = ? ORDER BY id DESC LIMIT ?', room, limit)
        .reverse()
        .map((r) => ({ id: Number(r.id), from: r.author, naam: r.naam, text: r.text, ts: Number(r.ts) })),
    addMessage: (m) => {
      const [r] = sql.all('INSERT INTO messages (room, author, naam, text, ts) VALUES (?, ?, ?, ?, ?) RETURNING id', room, m.from, m.naam, m.text, m.ts);
      // keep the last 1000 messages per group
      if (Number(r.id) % 50 === 0) sql.run('DELETE FROM messages WHERE room = ? AND id < (SELECT MIN(id) FROM (SELECT id FROM messages WHERE room = ? ORDER BY id DESC LIMIT 1000))', room, room);
      return { id: Number(r.id), ...m };
    },
  };
}
