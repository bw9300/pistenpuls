// The API, independent of where it runs. cloudflare.ts and node.ts only connect it to a platform.
import { Hono } from 'hono';
import { cors } from 'hono/cors';

export interface Env {
  /** Windy Webcams API key (https://api.windy.com/keys) */
  WINDY_KEY?: string;
}

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

export const app = new Hono<{ Bindings: Env }>().basePath('/api');

// the frontend may live on another host (config.json › apiBase)
app.use('*', cors());

app.get('/health', (c) => c.json({ ok: true }));

// Windy webcams near a point; the key stays on the server
app.get('/webcams', async (c) => {
  const key = c.env?.WINDY_KEY;
  if (!key) return c.json({ error: 'WINDY_KEY ontbreekt op de server' }, 503);
  const lat = Number(c.req.query('lat')), lon = Number(c.req.query('lon'));
  const radius = Math.min(30, Math.max(1, Math.round(Number(c.req.query('radius')) || 10)));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return c.json({ error: 'lat en lon zijn verplicht' }, 400);
  const u = `https://api.windy.com/webcams/api/v3/webcams?nearby=${lat.toFixed(4)},${lon.toFixed(4)},${radius}&limit=30&include=images,location,urls&lang=nl`;
  try {
    const body = await cached(u, 5 * 60_000, async () => {
      const r = await fetch(u, { headers: { 'x-windy-api-key': key } });
      if (!r.ok) throw new Error('Windy ' + r.status);
      return r.text();
    });
    return c.body(body, 200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' });
  } catch (e) {
    return c.json({ error: String((e as Error).message || e) }, 502);
  }
});
