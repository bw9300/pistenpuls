// Add a song to Après-ski King, or redo its notes.
//
//   npm run song:add -- --id schuhe --file ~/Downloads/schuhe.mp3 --titel "Schuhe" --artiest "…" [--start 4.9] [--bpm 147] [--dichtheid 1.7]
//   npm run song:add -- --id schuhe [--start 4.9] …     (existing song: only the notes are made again)
//
// Writes songs/<id>/audio.mp3 (re-encoded, so every browser decodes the same start) and songs/<id>/song.json:
// the beat grid and the notes. Then add the song to the list in shared/songs.ts.
//
// How the notes are made: the audio is cut in ~5 ms steps; where the sound suddenly gets louder (a drum, a new
// note, a word) is an onset. The tempo is the one that lines up most onsets; every onset is pulled onto the nearest
// half beat. The strongest ones become notes (whole beats first, a few half beats where the music asks for it),
// at most --dichtheid notes per second. The lane follows the pitch: low → bier, middle → Aperol, high → Jäger.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import type { Song } from '../shared/songs.ts';

const { values: a } = parseArgs({
  options: {
    id: { type: 'string' }, file: { type: 'string' }, titel: { type: 'string' }, artiest: { type: 'string' },
    start: { type: 'string' }, bpm: { type: 'string' }, dichtheid: { type: 'string' },
  },
});
if (!a.id || !/^[a-z0-9-]+$/.test(a.id)) fail('Geef een --id op (kleine letters, cijfers en streepjes), bijv. --id schuhe');
const dir = path.join('songs', a.id);
const audio = path.join(dir, 'audio.mp3'), jsonFile = path.join(dir, 'song.json');
const old: Partial<Song> = fs.existsSync(jsonFile) ? JSON.parse(fs.readFileSync(jsonFile, 'utf8')) : {};
if (a.file) {
  fs.mkdirSync(dir, { recursive: true });
  // 44.1 kHz stereo 160 kbit/s, no tags: small, and the same start in every browser
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', a.file, '-map_metadata', '-1', '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '160k', audio]);
} else if (!fs.existsSync(audio)) fail(`${audio} bestaat nog niet: geef een --file op`);
const titel = a.titel || old.titel, artiest = a.artiest ?? old.artiest ?? '';
if (!titel) fail('Geef een --titel op');
const startS = Number(a.start ?? (old.start ?? 0) / 1000);
const density = Number(a.dichtheid || 1.7);

// ---------- decode: mono, 22 050 Hz ----------
const SR = 22050;
const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', audio, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength >> 2);
const dur = pcm.length / SR;

// ---------- onsets: spectral flux ----------
const N = 1024, HOP = 110, FR = SR / HOP, LAG = 0.84;
const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
const LO = Math.round((40 * N) / SR), HI = Math.round((8000 * N) / SR);
const frames = Math.floor((pcm.length - N) / HOP);
const flux = new Float32Array(frames), pitch = new Float32Array(frames);
let prev = new Float32Array(HI);
const re = new Float32Array(N), im = new Float32Array(N);
for (let f = 0; f < frames; f++) {
  for (let i = 0; i < N; i++) { re[i] = pcm[f * HOP + i] * win[i]; im[i] = 0; }
  fft(re, im);
  const cur = new Float32Array(HI);
  let sum = 0, wsum = 0;
  for (let k = LO; k < HI; k++) {
    cur[k] = Math.log1p(10 * Math.hypot(re[k], im[k]));
    const d = cur[k] - prev[k];
    if (d > 0) { sum += d; wsum += d * Math.log2(k); }
  }
  flux[f] = sum;
  pitch[f] = sum ? wsum / sum : 0; // where (on a log scale) the new sound is
  prev = cur;
}
// a peak: the highest within ±50 ms, clearly above the average around it (±0.4 s)
const p99 = [...flux].sort((x, y) => x - y)[Math.floor(frames * 0.99)];
const AVG = Math.round(0.4 * FR), MAXW = Math.round(0.05 * FR);
const onsets: { t: number; s: number; p: number }[] = [];
for (let f = 1; f < frames - 1; f++) {
  let isMax = true;
  for (let j = Math.max(0, f - MAXW); j <= Math.min(frames - 1, f + MAXW) && isMax; j++) if (flux[j] > flux[f]) isMax = false;
  if (!isMax) continue;
  let m = 0, n = 0;
  for (let j = Math.max(0, f - AVG); j <= Math.min(frames - 1, f + AVG); j++) { m += flux[j]; n++; }
  const s = flux[f] - m / n;
  // the window starts at f*HOP; the jump is biggest when a new sound is LAG into it (measured with clicks)
  if (s > 0.08 * p99) onsets.push({ t: (f * HOP + N * LAG) / SR, s: s / p99, p: pitch[f] });
}

// ---------- tempo and the first beat: the grid that lines up most onsets ----------
function coherence(bpm: number) {
  const per = 60 / bpm;
  let x = 0, y = 0, w = 0;
  for (const o of onsets) { const ph = (2 * Math.PI * o.t) / per; x += o.s * Math.cos(ph); y += o.s * Math.sin(ph); w += o.s; }
  return { r: Math.hypot(x, y) / w, phase: (((Math.atan2(y, x) / (2 * Math.PI)) * per) % per + per) % per };
}
let bpm = Number(a.bpm) || 0;
if (!bpm) {
  let best = { r: 0, bpm: 0 };
  for (let b = 90; b <= 190; b += 0.01) { const { r } = coherence(b); if (r > best.r) best = { r, bpm: b }; }
  bpm = best.bpm;
}
const per = 60 / bpm, beat0 = coherence(bpm).phase, half = per / 2;

// ---------- onto the grid (half beats) ----------
const slots = new Map<number, { s: number; p: number; dev: number }>();
for (const o of onsets) {
  const i = Math.round((o.t - beat0) / half), dev = o.t - (beat0 + i * half);
  if (i < 0 || Math.abs(dev) > half * 0.3) continue;
  const was = slots.get(i);
  if (!was || o.s > was.s) slots.set(i, { s: o.s, p: o.p, dev });
}
const at = (i: number) => beat0 + i * half;
const end = dur - 1.2;
const cand = [...slots.entries()]
  .filter(([i]) => at(i) >= startS - 0.03 && at(i) <= end)
  // whole beats weigh more, the first beat of a bar a bit more still
  .map(([i, v]) => ({ i, ...v, w: v.s * (i % 2 ? 0.7 : i % 8 === 0 ? 1.25 : 1) }))
  .sort((x, y) => y.w - x.w);

// ---------- choose: whole beats first, then a few half beats (never more than two in a row) ----------
const target = Math.round((end - startS) * density);
const chosen = new Set<number>();
const free = (i: number, gap: number) => { for (let j = i - gap + 1; j < i + gap; j++) if (chosen.has(j)) return false; return true; };
for (const c of cand) {
  if (chosen.size >= target * 0.8) break;
  if (c.i % 2 === 0 && free(c.i, 2)) chosen.add(c.i);
}
for (const c of cand) {
  if (chosen.size >= target) break;
  if (chosen.has(c.i) || c.w < 0.25) continue;
  // the run of half-beat steps this note would be part of
  let run = 1;
  for (let j = c.i - 1; chosen.has(j); j--) run++;
  for (let j = c.i + 1; chosen.has(j); j++) run++;
  if (run <= 2 && !chosen.has(c.i - 2) && !chosen.has(c.i + 2)) chosen.add(c.i);
}
const notes = [...chosen].sort((x, y) => x - y).map((i) => ({ i, t: at(i), p: slots.get(i)!.p, lane: 1 }));

// ---------- lanes: by pitch, relative to the rest of the song ----------
const ps = notes.map((n) => n.p).sort((x, y) => x - y);
const q1 = ps[Math.floor(ps.length / 3)], q2 = ps[Math.floor((ps.length * 2) / 3)];
for (const n of notes) n.lane = n.p < q1 ? 0 : n.p < q2 ? 1 : 2;
// not four the same in a row: the fourth moves to the neighbouring lane its pitch is closest to
for (let k = 3; k < notes.length; k++) {
  const l = notes[k].lane;
  if (notes[k - 1].lane === l && notes[k - 2].lane === l && notes[k - 3].lane === l) notes[k].lane = l === 1 ? (notes[k].p < (q1 + q2) / 2 ? 0 : 2) : 1;
}

const song: Song = {
  id: a.id!, titel: titel!, artiest, bpm: Math.round(bpm * 100) / 100, beat0: Math.round(beat0 * 1000),
  start: Math.round(startS * 1000), duur: Math.round(dur * 1000),
  notes: notes.map((n) => [Math.round(n.t * 1000), n.lane]),
};
fs.writeFileSync(jsonFile, JSON.stringify(song).replace('"notes":[', '"notes":[\n').replace(/\],\[/g, '],\n[') + '\n');

const devs = notes.map((n) => Math.abs(slots.get(n.i)!.dev) * 1000).sort((x, y) => x - y);
const lanes = [0, 1, 2].map((l) => notes.filter((n) => n.lane === l).length);
console.log(`${song.titel}: ${dur.toFixed(1)} s, ${bpm.toFixed(2)} BPM (zekerheid ${coherence(bpm).r.toFixed(2)}), eerste tel op ${(beat0 * 1000).toFixed(0)} ms`);
console.log(`${notes.length} noten vanaf ${startS} s (${(notes.length / (end - startS)).toFixed(2)} per seconde), halve tellen: ${notes.filter((n) => n.i % 2).length}`);
console.log(`bier ${lanes[0]}, aperol ${lanes[1]}, jäger ${lanes[2]}; afwijking onset ↔ raster: mediaan ${devs[devs.length >> 1].toFixed(0)} ms, max ${devs[devs.length - 1].toFixed(0)} ms`);
console.log(`→ ${jsonFile}${old.id ? '' : '\nZet het nummer nog in de lijst in shared/songs.ts'}`);

// in-place radix-2 FFT
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar; im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar; im[i + k] += ai;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

function fail(msg: string): never { console.error(msg); process.exit(1); }
