// Ski race on the map: two skiers (head = their avatar) zigzag down the same piste, the camera follows.
// One big button: every tap pushes you further. The room counts the taps (server/games.ts); this only shows it.
import * as THREE from 'three';
import type { GameEvent, GameState, PisteRef } from '../shared/games';
import { MIN_TAP_MS, SKI_TAPS } from '../shared/ski';
import type { Live } from './live';
import { esc } from './settings';
import { COLORS, fmt } from './snowball';

/** what the race needs from the dashboard's 3D scene (app.ts) */
export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** a trip's world, if it's built */
  world(tripId: string): World | null;
  /** put a trip's map on screen and return its world */
  show(tripId: string): Promise<World | null>;
  /** steer the camera every frame (null: back to the tour) */
  drive(fn: ((dt: number) => { pos: THREE.Vector3; look: THREE.Vector3 } | null) | null): void;
}
interface World {
  runs: { k: 'b' | 'r' | 'z' | 's'; pts: [number, number, number][] }[];
  hAt(x: number, z: number): number;
  alt(y: number): number;
}

export const SKIER = '<svg class="skic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="15" cy="4.5" r="2.4" fill="#F4EDE1"/><path d="M13.5 8l-4 3.5 3 2.5-2 4.5" stroke="#E0533D" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.5 8l3 3.5 3 .5" stroke="#E0533D" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 17.5l17 3.5" stroke="#F0B45A" stroke-width="2" stroke-linecap="round"/></svg>';

const KIND = { b: 'blauwe piste', r: 'rode piste', z: 'zwarte piste', s: 'skiroute' };
const km = (m: number) => (m / 1000).toFixed(1).replace('.', ',') + ' km';
const len2d = (pts: [number, number, number][]) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]); return L; };

/** a random piste for a race: long enough to be fun, short enough to finish, and actually downhill */
export function pickPiste(w: World): PisteRef | null {
  const good = (min: number, max: number, drop: number) => w.runs.map((r, i) => ({ r, i, L: len2d(r.pts) }))
    .filter(({ r, L }) => L >= min && L <= max && Math.abs(w.alt(r.pts[0][1]) - w.alt(r.pts[r.pts.length - 1][1])) >= drop);
  const list = good(500, 3000, 120).length ? good(500, 3000, 120) : good(250, 5000, 50);
  if (!list.length) return null;
  const c = list[Math.floor(Math.random() * list.length)];
  return { i: c.i, label: `${KIND[c.r.k]} van ${km(c.L)}` };
}

// ---------- the piste as a path from top to bottom ----------
function pathOf(w: World, i: number) {
  const run = w.runs[i];
  if (!run) return null;
  const pts = run.pts[0][1] >= run.pts[run.pts.length - 1][1] ? run.pts : [...run.pts].reverse();
  const d = [0];
  for (let j = 1; j < pts.length; j++) d.push(d[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][2] - pts[j - 1][2]));
  const L = d[d.length - 1];
  /** point and direction (unit, on the ground) at distance s from the top */
  function at(s: number) {
    s = Math.max(0, Math.min(L, s));
    let lo = 0, hi = d.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m] <= s) lo = m; else hi = m; }
    const k = (s - d[lo]) / (d[hi] - d[lo] || 1), a = pts[lo], b = pts[hi];
    // direction smoothed over ±25 m, so the skiers don't jerk at every corner
    const p0 = pts[Math.max(0, lo - 2)], p1 = pts[Math.min(pts.length - 1, hi + 2)];
    const dx = p1[0] - p0[0], dz = p1[2] - p0[2], l = Math.hypot(dx, dz) || 1;
    return { x: a[0] + (b[0] - a[0]) * k, z: a[2] + (b[2] - a[2]) * k, tx: dx / l, tz: dz / l };
  }
  return { L, at };
}

// ---------- the skiers ----------
const FIG = 20; // the diorama is kilometres wide: skiers the size of a house, or you'd never see them

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = 4;
  return t;
}

function skier(naam: string, jacket: string, head: string) {
  const g = new THREE.Group(), mat = (c: string | number) => new THREE.MeshLambertMaterial({ color: c });
  const dark = mat('#26384A'), coat = mat(jacket);
  // skis
  for (const x of [-0.11, 0.11]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 1.15), mat('#F0B45A')); s.position.set(x, 0.015, 0.05); g.add(s); }
  // legs, body, arms (the body leans forward a bit)
  const body = new THREE.Group();
  for (const x of [-0.11, 0.11]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.45, 8), dark); l.position.set(x, 0.25, 0); l.rotation.x = 0.25; body.add(l); }
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.42, 12), coat); torso.position.y = 0.66; body.add(torso);
  for (const x of [-0.24, 0.24]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.36, 8), coat); arm.position.set(x, 0.66, 0.08); arm.rotation.x = -0.7; body.add(arm);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6), dark); pole.position.set(x * 1.2, 0.42, 0.22); pole.rotation.x = -0.35; body.add(pole);
  }
  // the head: their avatar (colour + first letter); later a photo
  const letter = (naam.trim()[0] || '?').toUpperCase();
  // the letter four times around, so it shows from every side (the camera is mostly behind them)
  const face = canvasTex(512, 128, (c) => {
    c.fillStyle = head; c.fillRect(0, 0, 512, 128);
    c.fillStyle = '#fff'; c.font = '800 72px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const x of [64, 192, 320, 448]) c.fillText(letter, x, 68);
  });
  const headM = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), new THREE.MeshLambertMaterial({ map: face }));
  headM.position.y = 1.05; headM.rotation.y = -Math.PI / 2; body.add(headM);
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mat('#F4EDE1')); hat.position.y = 1.29; body.add(hat);
  body.rotation.x = 0.2;
  g.add(body);
  // name above the head, always readable
  const tag = canvasTex(512, 128, (c) => {
    c.font = '700 60px system-ui, sans-serif'; const w = Math.min(500, c.measureText(naam).width + 60);
    c.fillStyle = 'rgba(15,27,38,.82)'; c.beginPath(); c.roundRect((512 - w) / 2, 14, w, 100, 50); c.fill();
    c.fillStyle = jacket; c.fillRect((512 - w) / 2 + 26, 54, 20, 20);
    c.fillStyle = '#F4EDE1'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(naam.slice(0, 14), 256 + 12, 66);
  });
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tag, depthTest: false, transparent: true }));
  label.scale.set(2.4, 0.6, 1); label.position.y = 1.75; label.renderOrder = 10;
  g.add(label);
  g.scale.setScalar(FIG);
  return { g, body };
}

function gate(w: World, p: { x: number; z: number; tx: number; tz: number }, color: string) {
  const g = new THREE.Group(), m = new THREE.MeshLambertMaterial({ color }), nx = -p.tz, nz = p.tx, half = 22;
  const H = FIG * 1.9;
  for (const s of [-1, 1]) {
    const x = p.x + nx * half * s, z = p.z + nz * half * s, y = w.hAt(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, H, 8), m); pole.position.set(x, y + H / 2, z); g.add(pole);
  }
  const y = Math.max(w.hAt(p.x + nx * half, p.z + nz * half), w.hAt(p.x - nx * half, p.z - nz * half)) + H;
  const banner = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 2, FIG * 0.45, 0.8), m);
  banner.position.set(p.x, y - FIG * 0.2, p.z); banner.rotation.y = Math.atan2(nx, nz) + Math.PI / 2; g.add(banner);
  return g;
}

// ---------- the race screen ----------
export function skiScreen(b: HTMLElement, live: Live, first: GameState, stage: Stage, done: () => void, again: () => void) {
  const me = live.state.me, them = first.a.id === me ? first.b : first.a;
  b.classList.add('skigame');
  b.innerHTML = `
    <div class="sktop">
      <div class="skrow me"><b>Jij</b><span class="skbar"><i data-bar="${me}"></i></span></div>
      <div class="skrow them"><b>${esc(them.naam)}</b><span class="skbar"><i data-bar="${them.id}"></i></span></div>
      <div class="skclock" data-clock></div>
    </div>
    <div class="sksay" data-say>Kaart laden…</div>
    <div class="skbottom">
      <p class="sbhelp">Tik zo snel je kunt op de knop. Hoe sneller je tikt, hoe sneller je skiet!</p>
      <button type="button" class="sktap" data-tap>${SKIER}<span>Tik snel!</span><small>of de spatiebalk</small></button>
      <button type="button" class="sbquit" data-quit>Stoppen</button>
    </div>`;
  const q = <T extends HTMLElement = HTMLElement>(s: string) => b.querySelector(s) as T;
  const say = q('[data-say]'), clock = q('[data-clock]'), tapBtn = q<HTMLButtonElement>('[data-tap]');
  let g = first, endAt = 0, over = false, sayT = 0, stopped = false;
  let myTaps = 0, lastTap = 0;
  const disp: Record<string, number> = { [me]: 0, [them.id]: 0 };

  function shout(text: string, cls = '', ms = 900) {
    say.textContent = text;
    say.className = 'sksay show ' + cls;
    clearTimeout(sayT);
    if (ms) sayT = window.setTimeout(() => (say.className = 'sksay'), ms);
  }

  // ---------- tapping ----------
  function tap() {
    const now = performance.now();
    if (g.status !== 'playing' || now - lastTap < MIN_TAP_MS) return;
    lastTap = now;
    myTaps = Math.min(SKI_TAPS, myTaps + 1);
    live.play(g.id, 'push');
    tapBtn.classList.remove('pop'); void tapBtn.offsetWidth; tapBtn.classList.add('pop');
  }
  tapBtn.onpointerdown = (e) => { e.preventDefault(); tap(); };
  tapBtn.onclick = (e) => { if (e.detail === 0) tap(); };
  const onKey = (e: KeyboardEvent) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && !over) { e.preventDefault(); tap(); } };
  addEventListener('keydown', onKey);
  q<HTMLButtonElement>('[data-quit]').onclick = () => {
    if (over) return done();
    if (confirm('Stoppen? Dan wint ' + them.naam + '.')) live.quit(g.id);
  };

  // ---------- the 3D part ----------
  let path: ReturnType<typeof pathOf> = null, world: World | null = null;
  const group = new THREE.Group();
  const skiers = { [me]: skier('Jij', COLORS.me, '#E0533D'), [them.id]: skier(them.naam, COLORS.them, '#5B9BD5') };
  const camPos = new THREE.Vector3(), look = new THREE.Vector3(), want = new THREE.Vector3(), wantLook = new THREE.Vector3();
  let t = 0, camReady = false;

  stage.show(live.trip).then((w) => {
    if (stopped) return;
    world = w;
    path = w && g.piste ? pathOf(w, g.piste.i) : null;
    if (!w || !path) { shout('Deze piste staat niet op jouw kaart, je ziet alleen de balken.', 'note', 0); return; }
    if (g.status === 'countdown' || g.status === 'invited') say.className = 'sksay';
    const top = path.at(0), bottom = path.at(path.L);
    group.add(gate(w, path.at(8), '#E0533D'), gate(w, bottom, '#F0B45A'));
    for (const s of Object.values(skiers)) group.add(s.g);
    stage.scene.add(group);
    camPos.copy(stage.camera.position);
    look.set(top.x, w.hAt(top.x, top.z), top.z);
    stage.drive(frame);
  });

  /** where a skier is after s metres: zigzagging across the piste, each on their own side */
  function place(id: string, s: number, side: number) {
    const p = path!.at(s), w = world!;
    const amp = 6, wave = 2 * Math.PI / 55, ph = side > 0 ? 0 : Math.PI;
    const off = side * 4 + amp * Math.sin(s * wave + ph), slope = amp * wave * Math.cos(s * wave + ph);
    const nx = -p.tz, nz = p.tx, x = p.x + nx * off, z = p.z + nz * off;
    const sk = skiers[id];
    sk.g.position.set(x, w.hAt(x, z) + 1.5, z);
    // face where they're going (down the piste + the zigzag), lean into the turn
    sk.g.rotation.y = Math.atan2(p.tx + nx * slope, p.tz + nz * slope);
    sk.body.rotation.z = -slope * 0.5;
    return p;
  }

  function frame(dt: number) {
    t += dt;
    if (!path || !world) return null;
    const L = path.L, k = Math.min(1, dt * 5);
    const myServer = g.score[me] || 0;
    myTaps = Math.max(myServer, Math.min(myTaps, myServer + 6)); // my own taps show right away; the room has the last word
    const target = { [me]: (over ? myServer : myTaps) / SKI_TAPS * L, [them.id]: (g.score[them.id] || 0) / SKI_TAPS * L };
    for (const id of [me, them.id]) disp[id] += (target[id] - disp[id]) * k;
    place(me, disp[me], -1);
    place(them.id, disp[them.id], 1);
    // camera: behind and above the two, looking at the one in front a bit more
    const lead = Math.max(disp[me], disp[them.id]), mid = (disp[me] + disp[them.id]) / 2, at = path.at(mid * 0.4 + lead * 0.6);
    const spread = Math.abs(disp[me] - disp[them.id]);
    const back = 120 + Math.min(260, spread * 0.6), up = 70 + Math.min(160, spread * 0.4);
    wantLook.set(at.x, world.hAt(at.x, at.z) + FIG, at.z);
    want.set(at.x - at.tx * back + at.tz * 40, wantLook.y + up, at.z - at.tz * back - at.tx * 40);
    const ground = world.hAt(want.x, want.z) + 40;
    if (want.y < ground) want.y = ground;
    const kc = camReady ? Math.min(1, dt * 2.2) : Math.min(1, dt * 1.2);
    camPos.lerp(want, kc); look.lerp(wantLook, kc);
    if (camPos.distanceTo(want) < 30) camReady = true;
    return { pos: camPos, look };
  }

  function bars() {
    for (const id of [me, them.id]) {
      const n = id === me ? Math.max(g.score[me] || 0, over ? 0 : myTaps) : g.score[id] || 0;
      q(`[data-bar="${id}"]`).style.width = (n / SKI_TAPS) * 100 + '%';
    }
  }

  function finish() {
    over = true;
    bars();
    const won = g.winner === me, draw = !g.winner;
    const title = draw ? 'Gelijk!' : won ? 'Gewonnen! 🏆' : `${esc(them.naam)} wint`;
    const why = g.end === 'quit' ? (won ? `${esc(them.naam)} gaf op.` : 'Je gaf op.')
      : g.end === 'left' ? (won ? `${esc(them.naam)} is weg.` : 'Je verbinding was weg.')
      : g.end === 'finish' ? `${won ? 'Jij was' : `${esc(them.naam)} was`} in ${((g.time || 0) / 1000).toFixed(1).replace('.', ',')} seconden beneden.`
      : 'De tijd is op.';
    const end = document.createElement('div');
    end.className = 'sbend skend';
    end.innerHTML = `<h2>${title}</h2><p>${why}</p><div class="sbrow"><button type="button" data-close>Sluiten</button>${live.state.online.some((o) => o.id === them.id) ? '<button type="button" class="primary" data-again>Nog een keer</button>' : ''}</div>`;
    b.append(end);
    end.querySelector<HTMLButtonElement>('[data-close]')!.onclick = done;
    end.querySelector<HTMLButtonElement>('[data-again]')?.addEventListener('click', again);
    (end.querySelector('[data-again]') as HTMLElement || end.querySelector('[data-close]') as HTMLElement).focus();
    b.classList.add('over');
    q<HTMLButtonElement>('[data-quit]').textContent = 'Sluiten';
  }

  const clockT = window.setInterval(() => { if (endAt && g.status === 'playing') clock.textContent = fmt(Math.max(0, endAt - Date.now())); }, 250);

  return {
    update(next: GameState, _ev?: GameEvent) {
      const was = g.status;
      g = next;
      endAt = Date.now() + g.left;
      if (g.status === 'countdown' && was !== 'countdown') {
        const n = Math.ceil(g.left / 1000);
        shout(String(n), 'count', 0);
        for (let s = n - 1; s >= 1; s--) setTimeout(() => g.status === 'countdown' && shout(String(s), 'count', 0), g.left - s * 1000);
      }
      if (g.status === 'playing' && was !== 'playing') { shout('Ga!', 'go', 1000); tapBtn.focus(); }
      bars();
      if (g.status === 'over' && !over) finish();
    },
    stop() {
      stopped = true;
      clearInterval(clockT);
      removeEventListener('keydown', onKey);
      stage.drive(null);
      stage.scene.remove(group);
      group.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); const mt = m.material as THREE.Material & { map?: THREE.Texture }; mt?.map?.dispose(); mt?.dispose?.(); });
    },
  };
}
