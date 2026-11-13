// Après-ski King in the browser: drinks slide down the bar to the music, tap them on the coaster.
// This browser plays the song and judges its own taps against the song's clock (the audio, not Date.now),
// and tells the room each judgement in order; the room keeps the score (server/games.ts).
import { COMBO_STEP, GOOD_MS, LANES, LEAD_MS, END_PAD_MS, PERFECT_MS, POINTS, mult, newTally, tally, type Judgement, type Tally } from '../shared/apresking';
import type { GameEvent, GameState } from '../shared/games';
import { SONGS, songById, type Song } from '../shared/songs';
import type { Live } from './live';
import { esc } from './settings';
import { fmt, loadingLayer, loadingState, lockEnd } from './snowball';

// ---------- the drinks ----------
const GLASS = '#E8EEF2';
const DRINKS = [
  // bier: a mug with a head of foam
  `<path d="M45 24h5a8 8 0 0 1 8 8v8a8 8 0 0 1-8 8h-5" fill="none" stroke="${GLASS}" stroke-width="5"/><rect x="11" y="16" width="35" height="43" rx="5" fill="#F2B233"/><rect x="16" y="25" width="5" height="28" rx="2.5" fill="#FFE29A" opacity=".85"/><circle cx="30" cy="44" r="1.6" fill="#FFE29A"/><circle cx="37" cy="35" r="1.2" fill="#FFE29A"/><circle cx="33" cy="51" r="1.2" fill="#FFE29A"/><rect x="11" y="16" width="35" height="43" rx="5" fill="none" stroke="${GLASS}" stroke-width="2.5"/><path d="M9 19c0-6 5-9 9-8 2-4 9-5 12-1 4-3 11-1 12 4 4 0 7 3 6 6-1 3-4 3-6 2H13c-3 0-4-1-4-3z" fill="#FFFDF5"/>`,
  // Aperol spritz: a wine glass, ice, a slice of orange
  `<path d="M13 9h38c0 19-7 30-19 30S13 28 13 9z" fill="#F26B1D"/><path d="M16 12h10c-1 9 1 17 5 22-9-2-14-10-15-22z" fill="#FF9B55" opacity=".7"/><rect x="24" y="14" width="9" height="9" rx="2" fill="#FFD3B0" opacity=".55" transform="rotate(-14 28 18)"/><rect x="34" y="19" width="8" height="8" rx="2" fill="#FFD3B0" opacity=".45" transform="rotate(10 38 23)"/><path d="M13 9h38c0 19-7 30-19 30S13 28 13 9z" fill="none" stroke="${GLASS}" stroke-width="2.5"/><rect x="30.5" y="38" width="3" height="16" fill="${GLASS}"/><ellipse cx="32" cy="56" rx="12" ry="3.5" fill="${GLASS}"/><circle cx="48" cy="9" r="8" fill="#FFB347" stroke="#FFE0A3" stroke-width="2"/><path d="M48 3v12M42 9h12M44 5l8 8M52 5l-8 8" stroke="#FFE0A3" stroke-width="1.2"/>`,
  // Jägermeister: a shot glass, dark, with the green label
  `<path d="M15 12h34l-4 46H19z" fill="${GLASS}" opacity=".3"/><path d="M17 22h30l-3.2 33H20.2z" fill="#5A2E12"/><path d="M18.3 35h27.4l-.9 10H19.2z" fill="#2F6B3F"/><circle cx="32" cy="40" r="3.3" fill="#F0B45A"/><path d="M29 36.5l-2-2.5M35 36.5l2-2.5" stroke="#F0B45A" stroke-width="1.3" stroke-linecap="round"/><path d="M15 12h34l-4 46H19z" fill="none" stroke="${GLASS}" stroke-width="2.5"/><path d="M20 53h24l-1 5H21z" fill="${GLASS}" opacity=".8"/>`,
];
const drink = (lane: number, cls = 'akic', size = '') => `<svg class="${cls}" viewBox="0 0 64 64"${size} aria-hidden="true">${DRINKS[lane]}</svg>`;
/** the chat button and the invite */
export const APRES = drink(0);

// ---------- sound: one AudioContext, unlocked by a tap (challenge, 'Ja, doe ik!') ----------
const AUDIO = import.meta.glob<string>('../songs/*/audio.mp3', { query: '?url', eager: true, import: 'default' });
let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();

/** call from a tap: browsers only play sound that a tap started */
export function unlockAudio(song?: string) {
  try {
    // iPhone: also with the ringer switch on silent
    const s = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (s) s.type = 'playback';
    ctx ||= new AudioContext({ latencyHint: 'interactive' });
    if (ctx.state !== 'running') ctx.resume();
    // a moment of silence, for older Safari
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start();
  } catch { /* no sound; the game still works */ }
  if (song) loadSong(song).catch(() => {});
}
function loadSong(id: string) {
  let p = buffers.get(id);
  if (!p) {
    const url = AUDIO[`../songs/${id}/audio.mp3`];
    p = (async () => {
      ctx ||= new AudioContext({ latencyHint: 'interactive' });
      const r = await fetch(url);
      if (!r.ok) throw new Error('audio ' + r.status);
      return ctx.decodeAudioData(await r.arrayBuffer());
    })();
    p.catch(() => buffers.delete(id));
    buffers.set(id, p);
  }
  return p;
}
/** for now any song; with more songs, this is where the choice goes */
export const pickSong = () => SONGS[Math.floor(Math.random() * SONGS.length)].id;
export const songTitle = (id?: string) => songById(id)?.titel || '';

// ---------- timing: what this device adds between the sound and the ear (Bluetooth!), learned from earlier games ----------
const LAT_KEY = 'pp-ak-lat';
const getLat = () => { try { return Number(localStorage.getItem(LAT_KEY)) || 0; } catch { return 0; } };
const setLat = (ms: number) => { try { localStorage.setItem(LAT_KEY, String(Math.round(ms))); } catch { /* fine */ } };

// ---------- the après-ski hut behind the bar ----------
const BULBS = ['#FFD45A', '#FF6B4A', '#6BD0FF', '#9BFF7A', '#FF8AD8'];
function scene() {
  const bulbs = Array.from({ length: 21 }, (_, i) => {
    const x = i * 50, y = 70 + 60 * Math.sin((Math.PI * x) / 1000);
    return `<line x1="${x}" y1="${y - 6}" x2="${x}" y2="${y + 4}" stroke="#222" stroke-width="3"/><circle class="bulb ${i % 2 ? 'o' : 'e'}" cx="${x}" cy="${y + 12}" r="9" fill="${BULBS[i % BULBS.length]}"/>`;
  }).join('');
  const dancer = (x: number, c: string, d: number) => `<g class="dancer${d ? ' o' : ''}" transform="translate(${x} 0)"><circle cx="0" cy="612" r="11" fill="${c}"/><path d="M-13 660q0-34 13-34t13 34z" fill="${c}"/><path d="M-11 636l-14-22M11 636l14-22" stroke="${c}" stroke-width="6" stroke-linecap="round"/></g>`;
  const HUT = `  <ellipse cx="160" cy="610" rx="260" ry="150" fill="url(#akglow)"/>
  <path d="M-20 540L160 420l180 120z" fill="#3A2416"/><path d="M-30 545L160 412l190 133-14 10L160 430-16 555z" fill="#F4F8FC"/>
  <rect x="0" y="540" width="320" height="170" fill="#7A4A26"/>
  <g stroke="#5C3519" stroke-width="3">${[560, 585, 610, 635, 660, 685].map((y) => `<line x1="0" y1="${y}" x2="320" y2="${y}"/>`).join('')}</g>
  <rect class="win" x="30" y="575" width="70" height="60" rx="4" fill="#FFC861"/><rect class="win" x="220" y="575" width="70" height="60" rx="4" fill="#FFC861"/>
  <path d="M65 575v60M30 605h70M255 575v60M220 605h70" stroke="#7A4A26" stroke-width="5"/>
  <rect x="120" y="600" width="80" height="110" fill="#4A2B16"/><circle cx="185" cy="655" r="4" fill="#F0B45A"/>
  <rect x="85" y="552" width="150" height="34" rx="6" fill="#2A160B" stroke="#F0B45A" stroke-width="3"/>
  <text x="160" y="577" text-anchor="middle" font-family="'Big Shoulders Display',Impact,sans-serif" font-weight="800" font-size="24" fill="#FFD45A">APRÈS-SKI</text>`;
  const UMBRELLA = `  <ellipse cx="840" cy="600" rx="240" ry="140" fill="url(#akglow)"/>
  <rect x="836" y="470" width="8" height="200" fill="#C9D3DC"/>
  <path d="M660 520q180-110 360 0z" fill="#E0533D"/><path d="M720 520q120-100 60-58zM840 410l-30 110h60zM960 520q-120-100-60-58z" fill="#F4EDE1"/>
  <path d="M660 520q30 18 60 0 30 18 60 0 30 18 60 0 30 18 60 0 30 18 60 0 30 18 60 0" fill="#E0533D"/>
  ${dancer(720, '#0F1B26', 0)}${dancer(780, '#16263A', 1)}${dancer(900, '#0F1B26', 1)}${dancer(960, '#16263A', 0)}
  <rect x="680" y="640" width="320" height="70" fill="#5C3519"/><rect x="670" y="632" width="340" height="14" rx="4" fill="#8A5A30"/>`;
  return `<svg class="akscene" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <defs>
    <linearGradient id="aksky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0B1230"/><stop offset=".55" stop-color="#2B1E4A"/><stop offset="1" stop-color="#6A2F55"/></linearGradient>
    <radialGradient id="akglow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFC861" stop-opacity=".55"/><stop offset="1" stop-color="#FFC861" stop-opacity="0"/></radialGradient>
    <linearGradient id="akbeam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="1000" height="1000" fill="url(#aksky)"/>
  <g fill="#fff" opacity=".7"><circle cx="120" cy="190" r="2"/><circle cx="300" cy="140" r="1.5"/><circle cx="520" cy="210" r="2"/><circle cx="700" cy="160" r="1.5"/><circle cx="860" cy="230" r="2"/><circle cx="420" cy="270" r="1.2"/><circle cx="640" cy="300" r="1.4"/></g>
  <path d="M0 520l140-170 90 80 150-200 130 150 110-90 170 180 90-60 120 110V1000H0z" fill="#26375E"/>
  <path d="M380 230l-52 69 40-14 22 30 40-28zM230 430l-40-44 26 6zM660 340l-42 42 38-8z" fill="#DCE6F2" opacity=".9"/>
  <path d="M0 600l200-110 160 80 180-120 200 140 120-70 140 90V1000H0z" fill="#1B2A4A"/>
  <path d="M0 700q250-60 500-20t500-10V1000H0z" fill="#D5E1EE"/>
  <g class="beams"><path class="beam l" d="M80 1000L30 300h120z" fill="url(#akbeam)"/><path class="beam r" d="M920 1000L850 300h120z" fill="url(#akbeam)"/></g>
  <!-- up the slope, beside the far end of the bar (what a phone shows), and big at the sides (wide screens) -->
  <g transform="translate(262 255) scale(.38)"><ellipse cx="160" cy="712" rx="240" ry="34" fill="#D5E1EE"/>${HUT}</g><g transform="translate(354 255) scale(.38)"><ellipse cx="840" cy="712" rx="220" ry="34" fill="#D5E1EE"/>${UMBRELLA}</g>
  ${HUT}${UMBRELLA}
  <path d="M0 40q500 120 1000 0" fill="none" stroke="#222" stroke-width="3"/>
  ${bulbs}
</svg>`;
}

// ---------- the game ----------
export function apresScreen(b: HTMLElement, live: Live, first: GameState, done: () => void, again: () => void) {
  const me = live.state.me, them = first.a.id === me ? first.b : first.a;
  const song = songById(first.song) as Song, notes = song.notes;
  const beatMs = 60_000 / song.bpm, LENGTH = song.duur + END_PAD_MS;
  b.classList.add('akgame');
  b.innerHTML = `${scene()}
    <div class="aktop">
      <div class="aks me"><b>Jij</b><strong data-score="me">0</strong><em data-mult="me"></em></div>
      <div class="akmid"><span class="aklead"><i data-lead></i></span><small data-clock></small></div>
      <div class="aks them"><b>${esc(them.naam)}</b><strong data-score="them">0</strong><em data-mult="them"></em></div>
    </div>
    <div class="akfield" data-field><canvas></canvas><div class="aksay" data-say></div></div>
    <div class="akbtns">${LANES.map((l, i) => `<button type="button" data-lane="${i}" style="--c:${l.kleur}">${drink(i)}<span>${l.naam}</span><small>${['←', '↓', '→'][i]}</small></button>`).join('')}</div>
    <button type="button" class="sbquit" data-quit>Stoppen</button>
    ${loadingLayer(APRES, 'Après-ski King laden', `${esc(song.titel)}${song.artiest ? ` · ${esc(song.artiest)}` : ''}. Zet je geluid aan 🔊`)}`;
  const q = <T extends HTMLElement = HTMLElement>(s: string) => b.querySelector(s) as T;
  const field = q('[data-field]'), canvas = field.querySelector('canvas')!, c2d = canvas.getContext('2d')!;
  const say = q('[data-say]'), clock = q('[data-clock]'), lead = q('[data-lead]');
  const loadText = q('[data-loadtext]');
  let g = first, over = false, raf = 0, sayT = 0, stopped = false;

  // ---------- loading: the song, and sound that may play ----------
  const loading = loadingState(b, () => live.play(g.id, 'ready'), them.naam);
  let buffer: AudioBuffer | null = null, needTap = false;
  loadSong(song.id).then((buf) => { buffer = buf; whenSound(); }).catch(() => { loadText.textContent = 'De muziek laadt niet. Je speelt zonder geluid.'; loading.ready(); });
  /** sound blocked (reloaded mid-game, or no tap yet): one tap to start it */
  function whenSound() {
    if (stopped) return;
    if (ctx?.state === 'running') { needTap = false; q('[data-load]').classList.toggle('gone', g.status !== 'loading'); loading.ready(); return schedule(); }
    if (needTap) return;
    needTap = true;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'primary';
    btn.textContent = 'Tik om te starten 🔊';
    btn.onclick = () => { unlockAudio(); btn.remove(); needTap = false; setTimeout(whenSound, 50); };
    q('[data-load]').classList.remove('gone');
    q('[data-load]').append(btn);
  }

  // ---------- the clock: the song as you hear it ----------
  /** performance.now() at which the song starts, by the room's countdown */
  let startPerf = 0, source: AudioBufferSourceNode | null = null, ctxStart = 0, lat = getLat();
  /** song ms = performance.now() + offset; smoothed, from the audio clock when it's playing */
  let offset = NaN;
  function schedule() {
    if (!startPerf || !buffer || !ctx || ctx.state !== 'running' || source || over) return;
    const now = performance.now(), ahead = (startPerf - now) / 1000;
    source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    source.connect(gain).connect(ctx.destination);
    ctxStart = ctx.currentTime + ahead;
    if (ahead >= 0) source.start(ctxStart);
    else if (-ahead < buffer.duration) source.start(0, -ahead);
    (source as AudioBufferSourceNode & { gain?: GainNode }).gain = gain;
  }
  function songNow(perf: number) {
    let raw = perf - startPerf;
    if (source && ctx) {
      // where the speaker is now: the output timestamp, or the clock minus what the browser says is in between
      const ts = ctx.getOutputTimestamp?.();
      const t = ts && ts.performanceTime ? ts.contextTime! + (perf - ts.performanceTime) / 1000 : ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
      raw = (t - ctxStart) * 1000;
    }
    const o = raw - perf;
    offset = Number.isNaN(offset) || Math.abs(o - offset) > 40 ? o : offset + (o - offset) * 0.1;
    return perf + offset - lat;
  }
  const songAt = (perf: number) => (Number.isNaN(offset) ? perf - startPerf : perf + offset) - lat;

  // ---------- notes and judging ----------
  const judged = new Int8Array(notes.length).fill(-1);
  const mine: Tally = newTally();
  let open = 0, sent = 0, lastMult = 1;
  const devs: number[] = [];
  const press = [0, 0, 0];
  const fx: { lane: number; at: number; j: Judgement; pts: number }[] = [];
  function judge(n: number, j: Judgement, perf: number) {
    judged[n] = j;
    tally(mine, j);
    if (j) fx.push({ lane: notes[n][1], at: perf, j, pts: POINTS[j] * mult(mine.combo) });
    const m = mult(mine.combo);
    if (m > lastMult) shout(['', '', 'Rondje! ×2', 'Nog een rondje! ×3', 'Après-ski King! ×4'][m], 'king', 1300);
    else shout(j === 2 ? 'Perfect!' : j === 1 ? 'Goed!' : 'Mis', j === 2 ? 'perfect' : j === 1 ? 'good' : 'miss', 500);
    lastMult = m;
    // in order: the room counts a skipped note as missed
    while (sent < notes.length && judged[sent] >= 0) { live.play(g.id, 'note', { n: sent, j: judged[sent] }); sent++; }
    while (open < notes.length && judged[open] >= 0) open++;
    hud();
  }
  function tap(lane: number, perf: number) {
    press[lane] = performance.now();
    if (g.status !== 'playing' || over) return;
    const t = songAt(perf);
    let best = -1;
    for (let n = open; n < notes.length && notes[n][0] - GOOD_MS <= t; n++) {
      if (judged[n] >= 0 || notes[n][1] !== lane || Math.abs(notes[n][0] - t) > GOOD_MS) continue;
      if (best < 0 || Math.abs(notes[n][0] - t) < Math.abs(notes[best][0] - t)) best = n;
    }
    if (best < 0) return; // a tap with nothing there costs nothing
    const dev = t - notes[best][0];
    devs.push(dev);
    judge(best, Math.abs(dev) <= PERFECT_MS ? 2 : 1, perf);
  }

  // ---------- buttons, the bar itself, keys ----------
  for (const btn of b.querySelectorAll<HTMLButtonElement>('[data-lane]')) {
    btn.onpointerdown = (e) => { e.preventDefault(); tap(Number(btn.dataset.lane), e.timeStamp); };
  }
  field.onpointerdown = (e) => {
    const r = field.getBoundingClientRect(), x = e.clientX - r.left, { cx, half } = geo();
    const lane = Math.floor(((x - (cx - half)) / (2 * half)) * 3);
    if (lane >= 0 && lane <= 2) { e.preventDefault(); tap(lane, e.timeStamp); }
  };
  const KEYS: Record<string, number> = { ArrowLeft: 0, a: 0, '1': 0, ArrowDown: 1, ArrowUp: 1, s: 1, ' ': 1, '2': 1, ArrowRight: 2, d: 2, '3': 2 };
  const onKey = (e: KeyboardEvent) => {
    const lane = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (lane === undefined || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    if (!e.repeat) tap(lane, e.timeStamp);
  };
  addEventListener('keydown', onKey);
  q<HTMLButtonElement>('[data-quit]').onclick = () => {
    if (over) return done();
    if (confirm('Stoppen? Dan wint ' + them.naam + '.')) live.quit(g.id);
  };

  // ---------- drawing ----------
  const imgs = DRINKS.map((_, i) => { const im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(drink(i, '', ' xmlns="http://www.w3.org/2000/svg" width="128" height="128"')); return im; });
  let W = 0, H = 0, dpr = 1;
  const ro = new ResizeObserver(() => {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = field.clientWidth; H = field.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
  });
  ro.observe(field);
  /** the bar in perspective: depth d 1 = far end (where drinks appear), 0 = the coasters */
  const FAR = 0.3;
  function geo() {
    const hitY = H * 0.84, topY = H * 0.03, half = Math.min(W * 0.47, H * 0.36), vY = (topY - FAR * hitY) / (1 - FAR);
    return { cx: W / 2, hitY, half, vY };
  }
  const at = (d: number) => {
    const { cx, hitY, half, vY } = geo(), s = 1 / (1 + d * (1 / FAR - 1));
    return { cx, y: vY + (hitY - vY) * s, half: half * s, s };
  };
  function draw(perf: number) {
    const pos = startPerf ? songNow(perf) : -1e9;
    c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    c2d.clearRect(0, 0, W, H);
    if (!W) return pos;
    // the bar: wood, three lanes, brass rails
    const far = at(1.08), near = at(-0.35);
    const wood = c2d.createLinearGradient(0, far.y, 0, near.y);
    wood.addColorStop(0, 'rgba(70,40,20,.75)'); wood.addColorStop(1, 'rgba(120,76,40,.95)');
    c2d.fillStyle = wood;
    c2d.beginPath(); c2d.moveTo(far.cx - far.half, far.y); c2d.lineTo(far.cx + far.half, far.y); c2d.lineTo(near.cx + near.half, near.y); c2d.lineTo(near.cx - near.half, near.y); c2d.fill();
    c2d.lineWidth = 1.5;
    for (let k = 1; k < 3; k++) {
      c2d.strokeStyle = 'rgba(255,220,170,.18)';
      c2d.beginPath(); c2d.moveTo(far.cx - far.half + (2 * far.half * k) / 3, far.y); c2d.lineTo(near.cx - near.half + (2 * near.half * k) / 3, near.y); c2d.stroke();
    }
    c2d.strokeStyle = '#C8963E'; c2d.lineWidth = 4;
    for (const side of [-1, 1]) { c2d.beginPath(); c2d.moveTo(far.cx + side * far.half, far.y); c2d.lineTo(near.cx + side * near.half, near.y); c2d.stroke(); }
    // a line on every beat, brighter on the first of a bar
    if (startPerf) {
      const k0 = Math.ceil((pos - song.beat0 - 150) / beatMs);
      for (let k = k0; song.beat0 + k * beatMs < pos + LEAD_MS * 1.08; k++) {
        const d = (song.beat0 + k * beatMs - pos) / LEAD_MS, p = at(d);
        c2d.strokeStyle = k % 4 ? 'rgba(255,230,190,.10)' : 'rgba(255,230,190,.28)';
        c2d.lineWidth = (k % 4 ? 1.5 : 3) * p.s;
        c2d.beginPath(); c2d.moveTo(p.cx - p.half, p.y); c2d.lineTo(p.cx + p.half, p.y); c2d.stroke();
      }
    }
    // the coasters
    const hit = at(0), lw = (2 * hit.half) / 3;
    for (let l = 0; l < 3; l++) {
      const x = hit.cx - hit.half + lw * (l + 0.5), glow = Math.max(0, 1 - (performance.now() - press[l]) / 160);
      c2d.fillStyle = 'rgba(15,27,38,.55)';
      c2d.beginPath(); c2d.ellipse(x, hit.y, lw * 0.42, lw * 0.16, 0, 0, 2 * Math.PI); c2d.fill();
      c2d.strokeStyle = LANES[l].kleur; c2d.lineWidth = 3 + glow * 4;
      c2d.globalAlpha = 0.6 + glow * 0.4; c2d.stroke(); c2d.globalAlpha = 1;
    }
    // the drinks, far ones first
    let last = open;
    while (last < notes.length && notes[last][0] < pos + LEAD_MS * 1.1) last++;
    for (let n = last - 1; n >= Math.max(0, open - 12); n--) {
      const [t, l] = notes[n], d = (t - pos) / LEAD_MS;
      if (judged[n] > 0 || d < -0.4 || d > 1.1) continue;
      const p = at(d), w = (2 * p.half) / 3, x = p.cx - p.half + w * (l + 0.5), size = w * 0.78;
      c2d.globalAlpha = (judged[n] === 0 ? 0.35 : 1) * Math.min(1, (1.1 - d) * 6);
      c2d.fillStyle = 'rgba(0,0,0,.3)';
      c2d.beginPath(); c2d.ellipse(x, p.y, size * 0.32, size * 0.09, 0, 0, 2 * Math.PI); c2d.fill();
      if (imgs[l].complete) c2d.drawImage(imgs[l], x - size / 2, p.y - size * 0.95, size, size);
    }
    c2d.globalAlpha = 1;
    // what a hit does: a ring and the points
    const nowP = performance.now();
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i], k = (nowP - f.at) / 450;
      if (k >= 1) { fx.splice(i, 1); continue; }
      const x = hit.cx - hit.half + lw * (f.lane + 0.5);
      c2d.strokeStyle = f.j === 2 ? '#FFD45A' : '#fff'; c2d.globalAlpha = 1 - k; c2d.lineWidth = 4;
      c2d.beginPath(); c2d.ellipse(x, hit.y, lw * (0.4 + k * 0.4), lw * (0.15 + k * 0.15), 0, 0, 2 * Math.PI); c2d.stroke();
      c2d.fillStyle = f.j === 2 ? '#FFD45A' : '#fff';
      c2d.font = `800 ${Math.round(lw * 0.28)}px 'Big Shoulders Display', Impact, sans-serif`;
      c2d.textAlign = 'center';
      c2d.fillText('+' + f.pts, x, hit.y - lw * (0.9 + k * 0.5));
    }
    c2d.globalAlpha = 1;
    return pos;
  }

  function frame() {
    const perf = performance.now(), pos = draw(perf);
    if (g.status === 'playing' && !over) {
      // drinks that went past the coaster
      while (open < notes.length && (judged[open] >= 0 || notes[open][0] + GOOD_MS < pos)) {
        if (judged[open] < 0) judge(open, 0, perf); else open++;
      }
    }
    if (startPerf) {
      // the lights and the dancers go with the beat
      const beat = (pos - song.beat0) / beatMs, f = beat - Math.floor(beat);
      b.style.setProperty('--beat', String(pos > 0 ? Math.max(0, 1 - f * 2.5) : 0));
      b.style.setProperty('--odd', String(Math.floor(beat) % 2));
      clock.textContent = fmt(Math.max(0, Math.min(song.duur, song.duur - pos)));
      if (pos > song.start - LEAD_MS - 900 && pos < song.start - LEAD_MS && !say.classList.contains('show')) shout('Daar komen ze!', 'go', 1200);
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  // ---------- scores at the top ----------
  function shout(text: string, cls = '', ms = 900) {
    say.textContent = text;
    say.className = 'aksay show ' + cls;
    clearTimeout(sayT);
    if (ms) sayT = window.setTimeout(() => (say.className = 'aksay'), ms);
  }
  function hud() {
    const mineScore = over ? g.score[me] || 0 : mine.score, theirs = g.score[them.id] || 0;
    const t = g.tally?.[them.id], myCombo = over ? 0 : mine.combo;
    q('[data-score="me"]').textContent = mineScore.toLocaleString('nl-NL');
    q('[data-score="them"]').textContent = theirs.toLocaleString('nl-NL');
    q('[data-mult="me"]').textContent = myCombo >= COMBO_STEP ? `×${mult(myCombo)}` : '';
    q('[data-mult="them"]').textContent = t && t.combo >= COMBO_STEP ? `×${mult(t.combo)}` : '';
    lead.style.width = (mineScore + theirs ? (mineScore / (mineScore + theirs)) * 100 : 50) + '%';
  }

  function finish() {
    over = true;
    const gain = (source as (AudioBufferSourceNode & { gain?: GainNode }) | null)?.gain;
    if (gain && ctx) gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    const won = g.winner === me, draw = !g.winner && g.end === 'finish';
    const title = draw ? 'Gelijkspel!' : won ? '👑 Jij bent Après-ski King!' : `👑 ${esc(them.naam)} is Après-ski King`;
    const t = g.tally?.[me];
    const why = g.end === 'quit' ? (won ? `${esc(them.naam)} gaf op.` : 'Je gaf op.') : g.end === 'left' ? (won ? `${esc(them.naam)} is weg.` : 'Je verbinding was weg.')
      : `${(g.score[me] || 0).toLocaleString('nl-NL')} – ${(g.score[them.id] || 0).toLocaleString('nl-NL')}`;
    // learn this device's delay: tapping steadily late (or early) means the sound reaches you later (or sooner)
    let tip = '';
    if (devs.length >= 12) {
      const m = [...devs].sort((x, y) => x - y)[devs.length >> 1];
      if (Math.abs(m) > 20) { setLat(Math.max(-150, Math.min(400, lat + m * 0.8))); tip = `<p class="aktip">Je tikte gemiddeld ${Math.abs(Math.round(m))} ms te ${m > 0 ? 'laat' : 'vroeg'}. Volgende keer houden we daar rekening mee.</p>`; }
    }
    const end = document.createElement('div');
    end.className = 'sbend skend akend';
    end.innerHTML = `<h2>${title}</h2><p>${why}</p>${t && g.end === 'finish' ? `<p class="akstats">${t.n[0]} perfect · ${t.n[1]} goed · ${t.n[2]} mis · beste reeks ${t.best}</p>` : ''}${tip}
      <div class="sbrow"><button type="button" data-close>Sluiten</button>${live.state.online.some((o) => o.id === them.id) ? '<button type="button" class="primary" data-again>Nog een keer</button>' : ''}</div>`;
    b.append(end);
    end.querySelector<HTMLButtonElement>('[data-close]')!.onclick = done;
    end.querySelector<HTMLButtonElement>('[data-again]')?.addEventListener('click', again);
    b.classList.add('over');
    q<HTMLButtonElement>('[data-quit]').textContent = 'Sluiten';
    lockEnd(end, q<HTMLButtonElement>('[data-quit]'));
    hud();
  }

  return {
    update(next: GameState, _ev?: GameEvent) {
      const was = g.status;
      g = next;
      loading.update(g);
      if (needTap) q('[data-load]').classList.remove('gone');
      if (g.status === 'countdown' && was !== 'countdown') {
        startPerf = performance.now() + g.left;
        schedule();
        shout(`${Math.ceil(g.left / 1000)}`, 'count', 0);
        for (let s = Math.ceil(g.left / 1000) - 1; s >= 1; s--) setTimeout(() => g.status === 'countdown' && shout(String(s), 'count', 0), g.left - s * 1000);
        setTimeout(() => !over && shout('Proost!', 'go', 1100), g.left);
      }
      // picked up mid-game (reload, reconnect)
      if (g.status === 'playing' && !startPerf) { startPerf = performance.now() - (LENGTH - g.left); schedule(); }
      hud();
      if (g.status === 'over' && !over) finish();
    },
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      removeEventListener('keydown', onKey);
      try { source?.stop(); } catch { /* not started */ }
    },
  };
}
