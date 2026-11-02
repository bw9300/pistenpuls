// Node: serves the API and (after `npm run build`) the frontend from ./dist. Works on any host that runs Node.
// Environment: WINDY_KEY (from .env or the host), PORT (default 8787).
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { app as api, type Env } from './app';

const env: Env = { WINDY_KEY: process.env.WINDY_KEY };
const port = Number(process.env.PORT) || 8787;

const root = new Hono();
root.all('/api/*', (c) => api.fetch(c.req.raw, env));
root.use('/*', serveStatic({ root: './dist' }));

serve({ fetch: root.fetch, port }, () => console.log(`Pistenpuls API op http://localhost:${port}`));
