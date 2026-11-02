// Snowball fight in the browser: the game screen and the result (inviting is in games.ts).
// The room decides what hits (server/games.ts); this only shows it and sends button presses.
import type { GameEvent, GameState } from '../shared/games';
import { DUCK_COOLDOWN_MS, DUCK_MS, RELOAD_MS, WIN_HITS } from '../shared/snowball';
import type { Live } from './live';
import { esc } from './settings';
import { avatarUrl } from './avatars';

/** the little snowball icon (chat buttons, invite) */
export const SNOWBALL = '<svg class="sbic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#F4F8FC"/><path d="M6 9.5c2-1 3.5-.6 5 .4M13.5 15c1.6.6 3 .5 4.5-.6M8 16.5c.6.4 1.4.6 2 .4" stroke="#A9C3D9" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="12" cy="12" r="9" fill="none" stroke="#7FA3C2" stroke-width="1.2"/></svg>';

/** a player; with a photo the face is the photo (and no hat over it) */
let figN = 0;
const figure = (c: string, photo: string | null) => {
  const clip = 'fh' + figN++;
  const head = photo
    ? `<clipPath id="${clip}"><circle cx="30" cy="25" r="13"/></clipPath><circle cx="30" cy="25" r="14" fill="${c}"/><image href="${photo}" x="17" y="12" width="26" height="26" clip-path="url(#${clip})" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="30" cy="27" r="12" fill="#F1C9A5"/><circle cx="35" cy="26" r="1.6" fill="#1B2633"/><path d="M33 32q3 1.5 5-.5" stroke="#1B2633" stroke-width="1.3" fill="none" stroke-linecap="round"/>
  <path d="M17.5 24Q30 4 42.5 24Z" fill="${c}"/><rect x="16.5" y="21" width="27" height="5" rx="2.5" fill="#F4EDE1"/><circle cx="30" cy="9" r="4.5" fill="#F4EDE1"/>`;
  return `<svg class="fig" viewBox="0 0 60 100" aria-hidden="true">
  <rect x="19" y="70" width="9" height="26" rx="4" fill="#26384A"/><rect x="32" y="70" width="9" height="26" rx="4" fill="#26384A"/>
  <rect x="13" y="39" width="34" height="38" rx="12" fill="${c}"/>
  <g class="arm"><rect x="40" y="42" width="9" height="27" rx="4.5" fill="${c}"/><circle cx="44.5" cy="70" r="4.5" fill="#F1C9A5"/></g>
  <rect x="17" y="37" width="26" height="7" rx="3.5" fill="#F4EDE1"/>
  ${head}
</svg>`;
};

export const COLORS = { me: '#E0533D', them: '#5B9BD5' };
/** the result stays put for a moment: whoever is still tapping or pressing space mustn't close it by accident */
export const END_LOCK_MS = 2000;
export function lockEnd(end: HTMLElement, ...more: HTMLButtonElement[]) {
  const buttons = [...end.querySelectorAll('button'), ...more];
  (document.activeElement as HTMLElement | null)?.blur?.();
  for (const x of buttons) x.disabled = true;
  end.classList.add('locked');
  end.style.setProperty('--lock', END_LOCK_MS + 'ms');
  setTimeout(() => {
    for (const x of buttons) x.disabled = false;
    end.classList.remove('locked');
    (end.querySelector('[data-again]') as HTMLElement || end.querySelector('[data-close]') as HTMLElement)?.focus();
  }, END_LOCK_MS);
}

export const fmt = (ms: number) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------- the game ----------
export function snowballScreen(b: HTMLElement, live: Live, first: GameState, done: () => void, again: () => void) {
  const me = live.state.me, iAmA = first.a.id === me, them = iAmA ? first.b : first.a;
  b.classList.add('sbgame');
  b.innerHTML = `
    <div class="sbtop">
      <div class="sbscore me"><b>Jij</b><span data-hits="${me}"></span></div>
      <div class="sbclock" data-clock></div>
      <div class="sbscore them"><b>${esc(them.naam)}</b><span data-hits="${them.id}"></span></div>
    </div>
    <div class="sbfield" data-field>
      <div class="sbp me" data-p="${me}">${figure(COLORS.me, avatarUrl(me))}</div>
      <div class="sbp them" data-p="${them.id}">${figure(COLORS.them, avatarUrl(them.id))}</div>
      <div class="sbwall me"></div><div class="sbwall them"></div>
      <div class="sbsay" data-say></div>
    </div>
    <p class="sbhelp">Tik op <b>Gooien</b> om te gooien. Komt er een sneeuwbal aan? Tik snel op <b>Bukken</b>!</p>
    <div class="sbbtns">
      <button type="button" class="sbduck" data-duck><span>Bukken</span><small>pijl omlaag</small></button>
      <button type="button" class="sbthrow" data-throw>${SNOWBALL}<span>Gooien</span><small>spatiebalk</small></button>
    </div>
    <button type="button" class="sbquit" data-quit>Stoppen</button>`;
  const q = <T extends HTMLElement = HTMLElement>(s: string) => b.querySelector(s) as T;
  const field = q('[data-field]'), say = q('[data-say]'), clock = q('[data-clock]');
  const throwBtn = q<HTMLButtonElement>('[data-throw]'), duckBtn = q<HTMLButtonElement>('[data-duck]');
  let g = first, endAt = 0, raf = 0, sayT = 0, over = false;
  let reloadAt = 0, duckAt = 0, duckUntil = 0;
  const balls: { el: HTMLElement; from: string; t0: number; dur: number }[] = [];

  function cooldown(btn: HTMLElement, ms: number) {
    btn.style.setProperty('--cd', ms + 'ms');
    btn.classList.remove('cd'); void btn.offsetWidth; btn.classList.add('cd');
  }
  function shout(text: string, cls = '', ms = 900) {
    say.textContent = text;
    say.className = 'sbsay show ' + cls;
    clearTimeout(sayT);
    if (ms) sayT = window.setTimeout(() => (say.className = 'sbsay'), ms);
  }
  const player = (id: string) => q(`[data-p="${id}"]`);
  function duck(id: string, ms: number) {
    const p = player(id);
    p.classList.add('duck');
    setTimeout(() => { if (id !== me || Date.now() >= duckUntil) p.classList.remove('duck'); }, ms);
  }

  // ---------- buttons and keys ----------
  function doThrow() {
    const now = Date.now();
    if (g.status !== 'playing' || now < reloadAt || now < duckUntil) return;
    reloadAt = now + RELOAD_MS;
    cooldown(throwBtn, RELOAD_MS);
    live.play(g.id, 'throw');
  }
  function doDuck() {
    const now = Date.now();
    if (g.status !== 'playing' || now < duckAt) return;
    duckAt = now + DUCK_COOLDOWN_MS;
    duckUntil = now + DUCK_MS;
    cooldown(duckBtn, DUCK_COOLDOWN_MS);
    duck(me, DUCK_MS); // right away; the room confirms
    live.play(g.id, 'duck');
  }
  // pointerdown: no click delay on phones
  throwBtn.onpointerdown = (e) => { e.preventDefault(); doThrow(); };
  duckBtn.onpointerdown = (e) => { e.preventDefault(); doDuck(); };
  throwBtn.onclick = (e) => { if (e.detail === 0) doThrow(); }; // keyboard activation
  duckBtn.onclick = (e) => { if (e.detail === 0) doDuck(); };
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); doThrow(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); doDuck(); }
  };
  addEventListener('keydown', onKey);
  q<HTMLButtonElement>('[data-quit]').onclick = () => {
    if (over) return done();
    if (confirm('Stoppen? Dan wint ' + them.naam + '.')) live.quit(g.id);
  };

  // ---------- flying snowballs ----------
  function launch(from: string, flight: number) {
    const el = document.createElement('i');
    el.className = 'sbball';
    field.append(el);
    // shown a bit faster than the room counts, so what you see isn't late (the message took a moment to arrive)
    balls.push({ el, from, t0: performance.now(), dur: Math.max(600, flight - 120) });
    const arm = player(from).querySelector('.arm');
    arm?.classList.remove('go'); void (arm as HTMLElement | null)?.getBoundingClientRect(); arm?.classList.add('go');
  }
  function land(on: string, hit: boolean) {
    // the oldest ball flying at 'on'
    const i = balls.findIndex((x) => x.from !== on);
    if (i >= 0) { const [ball] = balls.splice(i, 1); hit ? ball.el.remove() : ball.el.classList.add('fly'); setTimeout(() => ball.el.remove(), 500); }
    if (!hit) { shout(on === me ? 'Mis! Mooi gebukt' : 'Mis!', 'miss'); return; }
    const p = player(on);
    p.classList.remove('hit'); void p.offsetWidth; p.classList.add('hit');
    const splat = document.createElement('i');
    splat.className = 'sbsplat';
    const h = spot(on, 'head');
    splat.style.transform = `translate(${h.x}px, ${h.y}px)`;
    field.append(splat);
    setTimeout(() => splat.remove(), 900);
    if (on === me) { shout('Au, geraakt!', 'ouch'); navigator.vibrate?.(180); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); }
    else shout('Raak!', 'hit');
  }
  /** a point on a player, from its layout box (not moved by ducking): the throwing hand or the head */
  function spot(id: string, part: 'hand' | 'head') {
    const p = player(id), left = id === me;
    return part === 'hand'
      ? { x: p.offsetLeft + p.offsetWidth * (left ? 0.78 : 0.22), y: p.offsetTop + p.offsetHeight * 0.62 }
      : { x: p.offsetLeft + p.offsetWidth * 0.5, y: p.offsetTop + p.offsetHeight * 0.27 };
  }
  function frame() {
    const now = performance.now(), H = field.clientHeight;
    for (const ball of balls) {
      const k = Math.min(1, (now - ball.t0) / ball.dur);
      const a = spot(ball.from, 'hand'), t = spot(ball.from === me ? them.id : me, 'head');
      const x = a.x + (t.x - a.x) * k, y = a.y + (t.y - a.y) * k - Math.sin(Math.PI * k) * H * 0.28;
      ball.el.style.transform = `translate(${x}px, ${y}px) scale(${1 + Math.sin(Math.PI * k) * 0.3})`;
    }
    if (endAt) clock.textContent = g.status === 'countdown' ? '' : fmt(Math.max(0, endAt - Date.now()));
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function hits() {
    for (const p of [me, them.id]) {
      const n = g.score[p] || 0;
      q(`[data-hits="${p}"]`).innerHTML = Array.from({ length: WIN_HITS }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
      q(`[data-hits="${p}"]`).setAttribute('aria-label', `${n} van de ${WIN_HITS} keer raak`);
    }
  }

  function finish() {
    over = true;
    const won = g.winner === me, draw = !g.winner;
    const title = draw ? 'Gelijkspel!' : won ? 'Gewonnen! 🏆' : `${esc(them.naam)} wint`;
    const why = g.end === 'quit' ? (won ? `${esc(them.naam)} gaf op.` : 'Je gaf op.') : g.end === 'left' ? (won ? `${esc(them.naam)} is weg.` : 'Je verbinding was weg.') : `${g.score[me] || 0} – ${g.score[them.id] || 0}`;
    const end = document.createElement('div');
    end.className = 'sbend';
    end.innerHTML = `<h2>${title}</h2><p>${why}</p><div class="sbrow"><button type="button" data-close>Sluiten</button>${live.state.online.some((o) => o.id === them.id) ? '<button type="button" class="primary" data-again>Nog een keer</button>' : ''}</div>`;
    field.append(end);
    end.querySelector<HTMLButtonElement>('[data-close]')!.onclick = done;
    end.querySelector<HTMLButtonElement>('[data-again]')?.addEventListener('click', again);
    b.classList.add('over');
    q<HTMLButtonElement>('[data-quit]').textContent = 'Sluiten';
    lockEnd(end, q<HTMLButtonElement>('[data-quit]'));
  }

  return {
    update(next: GameState, ev?: GameEvent) {
      const was = g.status;
      g = next;
      endAt = Date.now() + g.left;
      hits();
      if (g.status === 'countdown' && was !== 'countdown') {
        shout(`${Math.ceil(g.left / 1000)}`, 'count', 0);
        for (let s = Math.ceil(g.left / 1000) - 1; s >= 1; s--) setTimeout(() => g.status === 'countdown' && shout(String(s), 'count', 0), g.left - s * 1000);
      }
      if (g.status === 'playing' && was !== 'playing') { shout('Gooien maar!', 'go', 1100); throwBtn.focus(); }
      if (ev?.k === 'throw') launch(ev.by, ev.flight);
      else if (ev?.k === 'duck' && ev.by !== me) duck(ev.by, ev.ms);
      else if (ev?.k === 'hit') land(ev.on, true);
      else if (ev?.k === 'miss') land(ev.on, false);
      if (g.status === 'over' && !over) finish();
    },
    stop() {
      cancelAnimationFrame(raf);
      removeEventListener('keydown', onKey);
    },
  };
}
