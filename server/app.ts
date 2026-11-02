// The API, independent of where it runs. cloudflare.ts and node.ts only connect it to a platform.
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { DATE_RE, EMAIL_RE, type AdminOnline } from '../shared/api.ts';
import { roomFor } from '../shared/live.ts';
import { cleanEmail, cleanName, MIN_PASSWORD, SESSION_DAYS, type Directory, type SessionUser } from './directory.ts';

export interface Env {
  /** Windy Webcams API key (https://api.windy.com/keys) */
  WINDY_KEY?: string;
}

export interface Platform<E> {
  /** the accounts database for this request */
  dir(env: E): Directory;
  /** who is connected to a room right now (for the admin panel) */
  presence(env: E, room: string): Promise<{ id: string; naam: string; visible: boolean }[]>;
}

export const SESSION_COOKIE = 'pp_session';

// small in-memory cache for upstream responses (per process / per worker isolate)
const cache = new Map<string, { t: number; body: string }>();
async function cached(key: string, ttlMs: number, load: () => Promise<string>): Promise<string> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.body;
  const body = await load();
  cache.set(key, { t: Date.now(), body });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return body;
}

const areaOk = (a: unknown) => typeof a === 'string' && /^[a-z0-9-]{1,40}$/.test(a);

export function createApp<E extends Env>(platform: Platform<E>) {
  // loosely typed on purpose: Hono's generics don't combine well with middleware on a generic Env
  type C = Context<any>;
  const app = new Hono<any>().basePath('/api');
  const user = (c: C): SessionUser => c.get('user');
  const dir = (c: C) => platform.dir(c.env as E);
  const body = async (c: C) => { try { return await c.req.json(); } catch { return {}; } };

  const signedIn = async (c: C, next: () => Promise<void>) => {
    const u = await dir(c).sessionUser(getCookie(c, SESSION_COOKIE));
    if (!u) return c.json({ error: 'niet ingelogd' }, 401);
    c.set('user', u);
    await next();
  };
  const admin = async (c: C, next: () => Promise<void>) => {
    if (!user(c).isAdmin) return c.json({ error: 'geen toegang' }, 403);
    await next();
  };

  app.get('/health', (c) => c.json({ ok: true }));

  // ---------- sign-in with a personal link (…/#invite=<token>) ----------
  const startSession = (c: C, session: string) => setCookie(c, SESSION_COOKIE, session, {
    httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86_400,
    secure: new URL(c.req.url).protocol === 'https:',
  });

  app.post('/auth/redeem', async (c) => {
    const { token } = await body(c);
    const session = typeof token === 'string' && token.length > 20 ? await dir(c).redeem(token) : null;
    if (!session) return c.json({ error: 'Deze link is al gebruikt of verlopen. Vraag een nieuwe aan.' }, 400);
    startSession(c, session);
    return c.json({ ok: true });
  });

  // ---------- or with email + password (set one in menu › Instellingen) ----------
  app.post('/auth/login', async (c) => {
    const b = await body(c), email = cleanEmail(b.email);
    if (!EMAIL_RE.test(email) || typeof b.password !== 'string' || !b.password || b.password.length > 200) return c.json({ error: 'Vul je e-mailadres en wachtwoord in.' }, 400);
    const r = await dir(c).login(email, b.password);
    if ('error' in r) return c.json({ error: r.error === 'locked' ? 'Te vaak een verkeerd wachtwoord. Probeer het over een kwartier opnieuw.' : 'E-mailadres of wachtwoord klopt niet.' }, r.error === 'locked' ? 429 : 401);
    startSession(c, r.session);
    return c.json({ ok: true });
  });

  app.post('/auth/logout', async (c) => {
    const t = getCookie(c, SESSION_COOKIE);
    if (t) await dir(c).logout(t);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // ---------- me ----------
  app.get('/me', signedIn, async (c) => c.json(await dir(c).me(user(c))));

  app.patch('/me', signedIn, async (c) => {
    const b = await body(c), u = user(c);
    const naam = b.naam === undefined ? null : cleanName(b.naam);
    if (naam === '') return c.json({ error: 'Vul je naam in.' }, 400);
    const dates = (Array.isArray(b.trips) ? b.trips : []).filter((t: any) => typeof t?.id === 'string' && DATE_RE.test(t?.aankomst));
    await dir(c).updateMe(u.id, naam, dates);
    return c.json(await dir(c).me({ ...u, naam: naam || u.naam }));
  });

  app.put('/me/password', signedIn, async (c) => {
    const { password } = await body(c);
    if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > 200) return c.json({ error: `Kies een wachtwoord van minstens ${MIN_PASSWORD} tekens.` }, 400);
    await dir(c).setPassword(user(c).id, password);
    return c.json({ ok: true });
  });

  /** a 15-minute link to sign in on another device */
  app.post('/me/device-link', signedIn, async (c) => c.json({ token: await dir(c).deviceLink(user(c).id) }));

  // ---------- admin ----------
  app.use('/admin/*', signedIn, admin);

  app.get('/admin/state', async (c) => c.json(await dir(c).adminState()));

  app.post('/admin/trips', async (c) => {
    const b = await body(c), naam = cleanName(b.naam);
    if (!areaOk(b.area) || !naam || !DATE_RE.test(b.aankomst)) return c.json({ error: 'Gebied, naam en aankomstdatum zijn verplicht.' }, 400);
    return c.json({ id: await dir(c).createTrip(b.area, naam, b.aankomst) });
  });
  app.put('/admin/trips/:id', async (c) => {
    const b = await body(c), naam = cleanName(b.naam);
    if (!areaOk(b.area) || !naam || !DATE_RE.test(b.aankomst)) return c.json({ error: 'Gebied, naam en aankomstdatum zijn verplicht.' }, 400);
    await dir(c).updateTrip(c.req.param('id'), b.area, naam, b.aankomst);
    return c.json({ ok: true });
  });
  app.delete('/admin/trips/:id', async (c) => { await dir(c).deleteTrip(c.req.param('id')); return c.json({ ok: true }); });

  app.post('/admin/users', async (c) => {
    const b = await body(c), email = cleanEmail(b.email), naam = cleanName(b.naam);
    if (!EMAIL_RE.test(email) || !naam) return c.json({ error: 'Naam en een geldig e-mailadres zijn verplicht.' }, 400);
    const id = await dir(c).createUser(email, naam);
    if (!id) return c.json({ error: 'Dit e-mailadres bestaat al.' }, 409);
    if (Array.isArray(b.trips)) await dir(c).updateUser(id, email, naam, b.trips.filter((t: unknown) => typeof t === 'string'));
    return c.json({ id });
  });
  app.put('/admin/users/:id', async (c) => {
    const b = await body(c), email = cleanEmail(b.email), naam = cleanName(b.naam);
    if (!EMAIL_RE.test(email) || !naam) return c.json({ error: 'Naam en een geldig e-mailadres zijn verplicht.' }, 400);
    const ok = await dir(c).updateUser(c.req.param('id'), email, naam, (Array.isArray(b.trips) ? b.trips : []).filter((t: unknown) => typeof t === 'string'));
    return ok ? c.json({ ok: true }) : c.json({ error: 'Dit e-mailadres is van iemand anders.' }, 409);
  });
  app.delete('/admin/users/:id', async (c) => {
    if (c.req.param('id') === user(c).id) return c.json({ error: 'Je kunt jezelf niet verwijderen.' }, 400);
    await dir(c).deleteUser(c.req.param('id'));
    return c.json({ ok: true });
  });
  app.post('/admin/users/:id/invite', async (c) => c.json({ token: await dir(c).invite(c.req.param('id')) }));
  app.post('/admin/users/:id/logout', async (c) => { await dir(c).logoutUser(c.req.param('id')); return c.json({ ok: true }); });

  app.get('/admin/online', async (c) => {
    const { trips } = await dir(c).adminState();
    const out: AdminOnline[] = await Promise.all(trips.map(async (t) => ({ trip: t.id, online: await platform.presence(c.env as E, roomFor(t.id)).catch(() => []) })));
    return c.json(out);
  });

  // ---------- Windy webcams near a point; the key stays on the server ----------
  app.get('/webcams', async (c) => {
    const key = (c.env as E)?.WINDY_KEY;
    if (!key) return c.json({ error: 'WINDY_KEY ontbreekt op de server' }, 503);
    const lat = Number(c.req.query('lat')), lon = Number(c.req.query('lon'));
    const radius = Math.min(30, Math.max(1, Math.round(Number(c.req.query('radius')) || 10)));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return c.json({ error: 'lat en lon zijn verplicht' }, 400);
    const u = `https://api.windy.com/webcams/api/v3/webcams?nearby=${lat.toFixed(4)},${lon.toFixed(4)},${radius}&limit=30&include=images,location,urls&lang=nl`;
    try {
      const txt = await cached(u, 5 * 60_000, async () => {
        const r = await fetch(u, { headers: { 'x-windy-api-key': key } });
        if (!r.ok) throw new Error('Windy ' + r.status);
        return r.text();
      });
      return c.body(txt, 200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' });
    } catch (e) {
      return c.json({ error: String((e as Error).message || e) }, 502);
    }
  });

  return app;
}

/** the session cookie from a raw Cookie header (for WebSocket upgrades, outside Hono) */
export function sessionFromCookieHeader(h: string | null | undefined) {
  const m = (h || '').match(new RegExp('(?:^|;\\s*)' + SESSION_COOKIE + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : undefined;
}
