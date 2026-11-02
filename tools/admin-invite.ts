// Create a personal sign-in link from the command line, e.g. the very first one for the admin.
//
//   npm run admin:invite -- --email bobvandewalle@gmail.com --naam Bob --admin --target prod
//   npm run admin:invite -- --email sanne@example.com --target preview
//
// --target: prod (default), preview or local (data/pistenpuls.db, for npm run dev). Adds the person if they don't exist yet.
// Everything else (trips, who belongs where) is done in the admin panel: 5× click the logo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { DIRECTORY_SCHEMA, INVITE_DAYS, newId } from '../server/directory.ts';

const { values: a } = parseArgs({
  options: { email: { type: 'string' }, naam: { type: 'string' }, admin: { type: 'boolean' }, target: { type: 'string', default: 'prod' }, url: { type: 'string' } },
});
const email = (a.email || '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Geef een geldig --email op');
const target = a.target!;
if (!['prod', 'preview', 'local'].includes(target)) fail('--target is prod, preview of local');

const token = crypto.randomBytes(32).toString('base64url');
const hash = crypto.createHash('sha256').update(token).digest('hex');
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const naam = (a.naam || email.split('@')[0]).slice(0, 30);
const user = `(SELECT id FROM users WHERE email = ${q(email)})`;
const statements = [
  ...DIRECTORY_SCHEMA,
  `INSERT OR IGNORE INTO users (id, email, naam, is_admin, created) VALUES (${q(newId())}, ${q(email)}, ${q(naam)}, ${a.admin ? 1 : 0}, ${Date.now()})`,
  ...(a.admin ? [`UPDATE users SET is_admin = 1 WHERE email = ${q(email)}`] : []),
  `DELETE FROM invites WHERE user_id = ${user} AND used IS NULL`,
  `INSERT INTO invites (token_hash, user_id, expires) VALUES (${q(hash)}, ${user}, ${Date.now() + INVITE_DAYS * 86_400_000})`,
];

if (target === 'local') {
  const { DatabaseSync } = await import('node:sqlite');
  fs.mkdirSync('data', { recursive: true });
  const db = new DatabaseSync(path.join(process.env.DATA_DIR || 'data', 'pistenpuls.db'));
  for (const s of statements) db.exec(s);
} else {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pp-')), 'invite.sql');
  fs.writeFileSync(file, statements.join(';\n') + ';\n');
  const args = ['wrangler', 'd1', 'execute', target === 'preview' ? 'pistenpuls-preview' : 'pistenpuls', '--remote', '--file', file, '-y'];
  if (target === 'preview') args.push('--env', 'preview');
  try { execFileSync('npx', args, { stdio: ['ignore', 'ignore', 'inherit'] }); }
  finally { fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
}

const base = a.url || { prod: 'https://pistenpuls.bvdwa.workers.dev', preview: 'https://pistenpuls-preview.bvdwa.workers.dev', local: 'http://localhost:5173' }[target];
console.log(`\n✓ Persoonlijke link voor ${naam} <${email}>${a.admin ? ' (admin)' : ''}, ${INVITE_DAYS} dagen geldig, werkt één keer:\n\n  ${base}/#invite=${token}\n`);

function fail(msg: string): never { console.error(msg); process.exit(1); }
