// Accounts: people (by email), trips, who belongs to which trip, invites and sessions.
// No platform code: works on any SQLite behind the Db interface (D1 on Cloudflare, node:sqlite on Node).
import type { AdminState, Me } from '../shared/api.ts';
import { MAX_NAME } from '../shared/live.ts';

export interface Db {
  all(q: string, ...p: unknown[]): Promise<any[]>;
  run(q: string, ...p: unknown[]): Promise<void>;
}

export const DIRECTORY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, naam TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, last_seen INTEGER)`,
  `CREATE TABLE IF NOT EXISTS trips (id TEXT PRIMARY KEY, area TEXT NOT NULL, naam TEXT NOT NULL, aankomst TEXT NOT NULL, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS trip_members (trip_id TEXT NOT NULL, user_id TEXT NOT NULL, aankomst TEXT, PRIMARY KEY (trip_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS invites (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER)`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL, last_used INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS passwords (user_id TEXT PRIMARY KEY, hash TEXT NOT NULL, updated INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS login_fails (email TEXT PRIMARY KEY, n INTEGER NOT NULL, first INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS avatars (user_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS reset_requests (user_id TEXT PRIMARY KEY, at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS trip_members_user ON trip_members (user_id)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)`,
];

const DAY = 86_400_000;
export const INVITE_DAYS = 14;
export const DEVICE_LINK_MINUTES = 15;
export const SESSION_DAYS = 365;
export const MIN_PASSWORD = 8;
/** wrong passwords per email before a 15-minute pause */
const MAX_FAILS = 10, FAIL_WINDOW = 15 * 60_000;

// ---------- small helpers ----------
const b64url = (a: Uint8Array) => btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function randomToken(bytes = 32) { return b64url(crypto.getRandomValues(new Uint8Array(bytes))); }
export function newId() {
  const a = crypto.getRandomValues(new Uint8Array(8));
  return [...a].map((b) => '0123456789abcdefghijklmnopqrstuvwxyz'[b % 36]).join('');
}
/** tokens are only stored hashed: a leaked database gives no working links or sessions */
export async function hashToken(t: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// passwords: PBKDF2-SHA256 (WebCrypto, so the same on Workers and Node; Workers allow at most 100k iterations)
const PBKDF2_ITER = 100_000;
const hex = (a: Uint8Array) => [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
async function pbkdf2(pw: string, salt: string, iter: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: iter }, key, 256)));
}
export async function hashPassword(pw: string) {
  const salt = randomToken(16);
  return `pbkdf2$${PBKDF2_ITER}$${salt}$${await pbkdf2(pw, salt, PBKDF2_ITER)}`;
}
async function checkPassword(pw: string, stored: string) {
  const [, iter, salt, h] = stored.split('$');
  const got = await pbkdf2(pw, salt, Number(iter));
  let d = got.length ^ h.length;
  for (let i = 0; i < got.length; i++) d |= got.charCodeAt(i) ^ (h.charCodeAt(i) || 0);
  return d === 0;
}

export const cleanName = (s: unknown) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_NAME);
export const cleanEmail = (s: unknown) => String(s ?? '').trim().toLowerCase().slice(0, 200);

export interface SessionUser { id: string; email: string; naam: string; isAdmin: boolean }
export type LoginResult = { session: string } | { error: 'wrong' | 'locked' };

export function directory(db: Db) {
  let ready: Promise<void> | null = null;
  const schema = () => (ready ??= (async () => { for (const q of DIRECTORY_SCHEMA) await db.run(q); })());

  async function createInvite(userId: string, ttlMs: number) {
    await schema();
    const token = randomToken();
    await db.run('INSERT INTO invites (token_hash, user_id, expires) VALUES (?, ?, ?)', await hashToken(token), userId, Date.now() + ttlMs);
    return token;
  }

  async function newSession(userId: string) {
    const session = randomToken();
    await db.run('INSERT INTO sessions (token_hash, user_id, created, last_used) VALUES (?, ?, ?, ?)', await hashToken(session), userId, Date.now(), Date.now());
    await db.run('UPDATE users SET last_seen = ? WHERE id = ?', Date.now(), userId);
    return session;
  }

  return {
    schema,

    // ---------- sign-in ----------
    /** invite token → new session token (the invite can't be used again); reset = this person asked for a new password */
    async redeem(inviteToken: string): Promise<{ session: string; reset: boolean } | null> {
      await schema();
      const h = await hashToken(inviteToken);
      const [inv] = await db.all('SELECT user_id, expires, used FROM invites WHERE token_hash = ?', h);
      if (!inv || inv.used || Number(inv.expires) < Date.now()) return null;
      await db.run('UPDATE invites SET used = ? WHERE token_hash = ?', Date.now(), h);
      const reset = (await db.all('SELECT 1 FROM reset_requests WHERE user_id = ?', inv.user_id)).length > 0;
      if (reset) await db.run('DELETE FROM reset_requests WHERE user_id = ?', inv.user_id);
      return { session: await newSession(inv.user_id), reset };
    },

    /** 'forgot my password': shows up in the admin panel, the admin sends a new link (there is no mail) */
    async requestReset(email: string) {
      await schema();
      const [u] = await db.all('SELECT id FROM users WHERE email = ?', email);
      if (u) await db.run('INSERT OR REPLACE INTO reset_requests (user_id, at) VALUES (?, ?)', u.id, Date.now());
    },

    /** email + password → new session; too many wrong attempts on one email pause it for 15 minutes */
    async login(email: string, password: string): Promise<LoginResult> {
      await schema();
      const [f] = await db.all('SELECT n, first FROM login_fails WHERE email = ?', email);
      const fresh = f && Number(f.first) > Date.now() - FAIL_WINDOW;
      if (fresh && Number(f.n) >= MAX_FAILS) return { error: 'locked' };
      const [r] = await db.all('SELECT u.id, p.hash FROM users u JOIN passwords p ON p.user_id = u.id WHERE u.email = ?', email);
      // always hash, so an unknown email takes as long as a wrong password
      const ok = await checkPassword(password, r?.hash || 'pbkdf2$100000$x$');
      if (!r || !ok) {
        if (fresh) await db.run('UPDATE login_fails SET n = n + 1 WHERE email = ?', email);
        else await db.run('INSERT OR REPLACE INTO login_fails (email, n, first) VALUES (?, 1, ?)', email, Date.now());
        return { error: 'wrong' };
      }
      await db.run('DELETE FROM login_fails WHERE email = ?', email);
      return { session: await newSession(r.id) };
    },

    async setPassword(userId: string, password: string) {
      await schema();
      await db.run('INSERT OR REPLACE INTO passwords (user_id, hash, updated) VALUES (?, ?, ?)', userId, await hashPassword(password), Date.now());
    },

    async sessionUser(sessionToken: string | undefined): Promise<SessionUser | null> {
      if (!sessionToken) return null;
      await schema();
      const h = await hashToken(sessionToken);
      const [r] = await db.all('SELECT u.id, u.email, u.naam, u.is_admin, s.last_used FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', h);
      if (!r || Number(r.last_used) < Date.now() - SESSION_DAYS * DAY) return null;
      // touch at most once per 10 minutes
      if (Number(r.last_used) < Date.now() - 10 * 60_000) {
        await db.run('UPDATE sessions SET last_used = ? WHERE token_hash = ?', Date.now(), h);
        await db.run('UPDATE users SET last_seen = ? WHERE id = ?', Date.now(), r.id);
      }
      return { id: r.id, email: r.email, naam: r.naam, isAdmin: !!Number(r.is_admin) };
    },

    async logout(sessionToken: string) {
      await schema();
      await db.run('DELETE FROM sessions WHERE token_hash = ?', await hashToken(sessionToken));
    },

    /** a short-lived link for one of my other devices */
    deviceLink: (userId: string) => createInvite(userId, DEVICE_LINK_MINUTES * 60_000),

    async seen(userId: string) {
      await db.run('UPDATE users SET last_seen = ? WHERE id = ?', Date.now(), userId);
    },

    // ---------- me ----------
    async me(u: SessionUser): Promise<Me> {
      await schema();
      const trips = await db.all('SELECT t.id, t.area, t.naam, t.aankomst AS reis, m.aankomst FROM trip_members m JOIN trips t ON t.id = m.trip_id WHERE m.user_id = ? ORDER BY COALESCE(m.aankomst, t.aankomst)', u.id);
      const hasPassword = (await db.all('SELECT 1 FROM passwords WHERE user_id = ?', u.id)).length > 0;
      const [av] = await db.all('SELECT updated FROM avatars WHERE user_id = ?', u.id);
      const resets = u.isAdmin ? Number((await db.all('SELECT COUNT(*) AS n FROM reset_requests'))[0].n) : 0;
      return { user: { ...u, hasPassword, avatar: av ? Number(av.updated) : null }, resets, trips: trips.map((t) => ({ id: t.id, area: t.area, naam: t.naam, aankomstReis: t.reis, aankomst: t.aankomst || null })) };
    },

    async updateMe(userId: string, naam: string | null, dates: { id: string; aankomst: string }[]) {
      await schema();
      if (naam) await db.run('UPDATE users SET naam = ? WHERE id = ?', naam, userId);
      for (const d of dates) await db.run('UPDATE trip_members SET aankomst = ? WHERE trip_id = ? AND user_id = ?', d.aankomst, d.id, userId);
    },

    // ---------- profile photos: only for people you share a trip with ----------
    async setAvatar(userId: string, data: string) {
      await schema();
      await db.run('INSERT OR REPLACE INTO avatars (user_id, data, updated) VALUES (?, ?, ?)', userId, data, Date.now());
    },
    async deleteAvatar(userId: string) {
      await schema();
      await db.run('DELETE FROM avatars WHERE user_id = ?', userId);
    },
    /** whose photos I may see, with their version (for the image address) */
    async avatarVersions(viewer: string): Promise<Record<string, number>> {
      await schema();
      const rows = await db.all(`SELECT a.user_id, a.updated FROM avatars a WHERE a.user_id = ? OR a.user_id IN
          (SELECT o.user_id FROM trip_members o JOIN trip_members m ON m.trip_id = o.trip_id WHERE m.user_id = ?)`, viewer, viewer);
      return Object.fromEntries(rows.map((r) => [r.user_id, Number(r.updated)]));
    },
    async avatar(viewer: SessionUser, target: string): Promise<string | null> {
      await schema();
      const [r] = await db.all(`SELECT data FROM avatars WHERE user_id = ? AND (? = ? OR ? = 1 OR EXISTS
          (SELECT 1 FROM trip_members o JOIN trip_members m ON m.trip_id = o.trip_id WHERE o.user_id = ? AND m.user_id = ?))`,
        target, target, viewer.id, viewer.isAdmin ? 1 : 0, target, viewer.id);
      return r ? r.data : null;
    },

    async isMember(userId: string, tripId: string) {
      await schema();
      return (await db.all('SELECT 1 FROM trip_members WHERE user_id = ? AND trip_id = ?', userId, tripId)).length > 0;
    },

    // ---------- admin ----------
    async adminState(): Promise<AdminState> {
      await schema();
      const trips = await db.all('SELECT t.id, t.area, t.naam, t.aankomst, (SELECT COUNT(*) FROM trip_members m WHERE m.trip_id = t.id) AS members FROM trips t ORDER BY t.aankomst');
      const users = await db.all(`SELECT u.id, u.email, u.naam, u.is_admin, u.last_seen,
          (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS sessions,
          (SELECT COUNT(*) FROM invites i WHERE i.user_id = u.id AND i.used IS NULL AND i.expires > ?) AS invites,
          (SELECT COUNT(*) FROM reset_requests r WHERE r.user_id = u.id) AS reset,
          (SELECT updated FROM avatars a WHERE a.user_id = u.id) AS avatar
        FROM users u ORDER BY u.naam COLLATE NOCASE`, Date.now());
      const members = await db.all('SELECT trip_id, user_id FROM trip_members');
      return {
        trips: trips.map((t) => ({ id: t.id, area: t.area, naam: t.naam, aankomst: t.aankomst, members: Number(t.members) })),
        users: users.map((u) => ({
          id: u.id, email: u.email, naam: u.naam, isAdmin: !!Number(u.is_admin), lastSeen: u.last_seen == null ? null : Number(u.last_seen),
          sessions: Number(u.sessions), invitePending: Number(u.invites) > 0, resetRequested: Number(u.reset) > 0, avatar: u.avatar == null ? null : Number(u.avatar),
          trips: members.filter((m) => m.user_id === u.id).map((m) => m.trip_id),
        })),
      };
    },

    async createTrip(area: string, naam: string, aankomst: string) {
      await schema();
      const id = newId();
      await db.run('INSERT INTO trips (id, area, naam, aankomst, created) VALUES (?, ?, ?, ?, ?)', id, area, naam, aankomst, Date.now());
      return id;
    },
    async updateTrip(id: string, area: string, naam: string, aankomst: string) {
      await db.run('UPDATE trips SET area = ?, naam = ?, aankomst = ? WHERE id = ?', area, naam, aankomst, id);
    },
    async deleteTrip(id: string) {
      await db.run('DELETE FROM trip_members WHERE trip_id = ?', id);
      await db.run('DELETE FROM trips WHERE id = ?', id);
    },

    /** null when the email is already in use */
    async createUser(email: string, naam: string, isAdmin = false): Promise<string | null> {
      await schema();
      if ((await db.all('SELECT 1 FROM users WHERE email = ?', email)).length) return null;
      const id = newId();
      await db.run('INSERT INTO users (id, email, naam, is_admin, created) VALUES (?, ?, ?, ?, ?)', id, email, naam, isAdmin ? 1 : 0, Date.now());
      return id;
    },
    /** false when the email belongs to someone else */
    async updateUser(id: string, email: string, naam: string, trips: string[]) {
      if ((await db.all('SELECT 1 FROM users WHERE email = ? AND id != ?', email, id)).length) return false;
      await db.run('UPDATE users SET email = ?, naam = ? WHERE id = ?', email, naam, id);
      const known = new Set((await db.all('SELECT id FROM trips')).map((t) => t.id));
      const now = new Set((await db.all('SELECT trip_id FROM trip_members WHERE user_id = ?', id)).map((r) => r.trip_id));
      const want = new Set(trips.filter((t) => known.has(t)));
      for (const t of now) if (!want.has(t)) await db.run('DELETE FROM trip_members WHERE trip_id = ? AND user_id = ?', t, id);
      for (const t of want) if (!now.has(t)) await db.run('INSERT INTO trip_members (trip_id, user_id) VALUES (?, ?)', t, id);
      return true;
    },
    async deleteUser(id: string) {
      for (const t of ['trip_members', 'sessions', 'invites', 'passwords', 'reset_requests', 'avatars']) await db.run(`DELETE FROM ${t} WHERE user_id = ?`, id);
      await db.run('DELETE FROM users WHERE id = ?', id);
    },
    /** a fresh personal invite; older unused ones stop working */
    async invite(userId: string) {
      await db.run('DELETE FROM invites WHERE user_id = ? AND used IS NULL', userId);
      return createInvite(userId, INVITE_DAYS * DAY);
    },
    async logoutUser(userId: string) {
      await db.run('DELETE FROM sessions WHERE user_id = ?', userId);
    },
  };
}

export type Directory = ReturnType<typeof directory>;
