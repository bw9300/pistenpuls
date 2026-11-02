// Add a ski area, or refresh its stored map data.
//
//   npm run area:add -- --id ischgl --naam "Ischgl/Samnaun" --bbox 10.2,46.95,10.35,47.03 [--kort Ischgl] [--regio "Paznaun"] [--van 2027-01-16]
//   npm run area:add -- --id zillertal          (existing area: only regenerates map.json from its area.json)
//
// Writes areas/<id>/area.json (only if it doesn't exist yet; edit it afterwards) and areas/<id>/map.json:
// a ~50 m elevation grid plus pistes, lifts and buildings from OpenStreetMap, in the format src/terrain.ts decodes.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import { CONFIG, type Area } from '../src/config.ts';
import { PI, tileRange, makeDem, parseOsm, pisteClass } from '../src/terrain.ts';

const { values: a } = parseArgs({
  options: { id: { type: 'string' }, naam: { type: 'string' }, kort: { type: 'string' }, regio: { type: 'string' }, van: { type: 'string' }, bbox: { type: 'string' } },
});
if (!a.id || !/^[a-z0-9-]+$/.test(a.id)) fail('Geef een --id op (kleine letters, cijfers en streepjes), bijv. --id ischgl');

const dir = path.join('areas', a.id);
const areaFile = path.join(dir, 'area.json');
let area: Area;
if (fs.existsSync(areaFile)) {
  area = JSON.parse(fs.readFileSync(areaFile, 'utf8'));
  console.log(`${area.naam}: bestaand gebied, kaartdata wordt vernieuwd`);
} else {
  if (!a.naam || !a.bbox) fail('Nieuw gebied: --naam en --bbox west,zuid,oost,noord zijn verplicht');
  const bbox = a.bbox!.split(',').map(Number) as Area['bbox'];
  if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n)) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) fail('--bbox moet west,zuid,oost,noord zijn, bijv. 10.2,46.95,10.35,47.03');
  if (bbox[2] - bbox[0] > 0.45 || bbox[3] - bbox[1] > 0.3) console.warn('Let op: groot gebied (>~30 km), laden wordt traag');
  const kort = a.kort || a.naam!;
  area = { id: a.id!, naam: a.naam!, kort, regio: a.regio || '', hallo: 'Servus', groet: `Servus, ${kort}.`, groetSub: '', van: a.van || '', bbox, meetstations: {} };
}

const store = await buildMap(area.bbox);
fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(areaFile)) {
  fs.writeFileSync(areaFile, JSON.stringify(area, null, 2) + '\n');
  console.log(`✓ ${areaFile} aangemaakt: vul regio, groetSub en van (voorgestelde aankomst) nog aan`);
}
fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify(store));
console.log(`✓ ${path.join(dir, 'map.json')}: ${store.pistes.length} pistes, ${store.lifts.length} liften, ${store.houses.length} gebouwen`);

// ---------------------------------------------------------------------------------------------------------

async function buildMap(bbox: Area['bbox']) {
  const [w, s, e, n] = bbox, lat0 = (s + n) / 2, lon0 = (w + e) / 2;
  const kx = 111320 * Math.cos((lat0 * PI) / 180), kz = 110574;

  console.log('Hoogtedata ophalen…');
  const range = tileRange(bbox, CONFIG.terrainZoom), tiles = [];
  for (let x = range.x0; x <= range.x1; x++) for (let y = range.y0; y <= range.y1; y++) tiles.push({ x, y, data: await terrainTile(range.z, x, y) });
  const elev = makeDem(tiles, range);
  const nx = Math.round(((e - w) * kx) / 50) + 1, ny = Math.round(((n - s) * kz) / 50) + 1, g = new Int16Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) g[j * nx + i] = Math.round(elev(w + ((e - w) * i) / (nx - 1), n - ((n - s) * j) / (ny - 1)));
  const dem = { nx, ny, b64: Buffer.from(g.buffer).toString('base64') };

  const bb = `${s},${w},${n},${e}`;
  console.log('Pistes en liften uit OpenStreetMap…');
  const ski = parseOsm(await overpass(`[out:json][timeout:120];(way["piste:type"="downhill"](${bb});way["aerialway"](${bb}););out geom;`));
  console.log('Gebouwen uit OpenStreetMap (kan een paar minuten duren)…');
  const dorp = parseOsm(await overpass(`[out:json][timeout:180];way["building"](${bb});out geom;`));

  const enc = (pts: number[][]) => { const out: number[] = []; let px = 0, py = 0; for (const [lo, la] of pts) { const x = Math.round(lo * 1e5), y = Math.round(la * 1e5); out.push(x - px, y - py); px = x; py = y; } return out; };
  const proj = (lon: number, lat: number) => [(lon - lon0) * kx, -(lat - lat0) * kz];

  // same oriented-box fit as buildHouses() in src/terrain.ts, stored in degrees
  const houses: number[][] = [];
  for (const b of dorp.buildings as any[]) {
    const pts = b.g.map(([lo, la]: number[]) => proj(lo, la));
    let mx = 0, mz = 0; for (const p of pts) { mx += p[0]; mz += p[1]; } mx /= pts.length; mz /= pts.length;
    let best = 0, ang = 0;
    for (let i = 0; i < pts.length - 1; i++) { const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1], l = dx * dx + dz * dz; if (l > best) { best = l; ang = Math.atan2(dz, dx); } }
    const ca = Math.cos(ang), sa = Math.sin(ang); let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
    for (const p of pts) { const u = (p[0] - mx) * ca + (p[1] - mz) * sa, v = -(p[0] - mx) * sa + (p[1] - mz) * ca; a0 = Math.min(a0, u); a1 = Math.max(a1, u); b0 = Math.min(b0, v); b1 = Math.max(b1, v); }
    const len = Math.max(4, a1 - a0), wid = Math.max(4, b1 - b0); if (len > 160 || wid > 160) continue;
    const x = mx + ((a0 + a1) / 2) * ca - ((b0 + b1) / 2) * sa, z = mz + ((a0 + a1) / 2) * sa + ((b0 + b1) / 2) * ca;
    const lon = lon0 + x / kx, lat = lat0 - z / kz;
    if (lon < w || lon > e || lat < s || lat > n) continue;
    houses.push([Math.round(lon * 1e5), Math.round(lat * 1e5), Math.round(len * 10), Math.round(wid * 10), Math.round(ang * 1000), b.levels || 0]);
  }

  return {
    v: 1, created: new Date().toISOString(), bbox, dem,
    pistes: ski.pistes.map((p: any) => [pisteClass(p.diff), enc(p.g)]),
    lifts: ski.lifts.map((l: any) => [l.type, l.name, enc(l.g)]),
    houses,
  };
}

async function terrainTile(z: number, x: number, y: number): Promise<Uint8Array> {
  let last: unknown;
  for (const u of CONFIG.terrainUrls) {
    try {
      const r = await fetch(u.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)));
      if (!r.ok) throw new Error('tegel ' + r.status);
      return PNG.sync.read(Buffer.from(await r.arrayBuffer())).data;
    } catch (e) { last = e; }
  }
  throw last;
}

async function overpass(q: string) {
  let last: unknown;
  for (let round = 0; round < 3; round++) for (const u of CONFIG.overpassUrls) {
    if (round) await new Promise((r) => setTimeout(r, 20_000 * round)); // busy servers answer 429: wait a bit
    try {
      // overpass-api.de refuses requests without a recognisable User-Agent (406)
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'pistenpuls-add-area/1.0', Accept: 'application/json' };
      const r = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers, signal: AbortSignal.timeout(200_000) });
      if (!r.ok) throw new Error('Overpass ' + r.status);
      return await r.json();
    } catch (e) { last = e; console.warn('  ', u, (e as Error).message); }
  }
  throw last;
}

function fail(msg: string): never { console.error(msg); process.exit(1); }
