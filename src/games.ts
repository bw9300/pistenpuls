// Mini games in the browser, around the game itself: choosing a game, the invite, waiting for an answer, loading.
// The game screens are in snowball.ts and ski.ts. The room is the referee (server/games.ts).
// Only the tab that challenged or accepted plays; other tabs of the same person just close their dialog.
import { GAME_WORDS, type GameEvent, type GameKind, type GameState } from '../shared/games';
import { WIN_HITS } from '../shared/snowball';
import type { Live } from './live';
import { esc } from './settings';
import { SNOWBALL, snowballScreen } from './snowball';
import { pickPiste, skiScreen, SKIER, type Stage } from './ski';

const ICON: Record<GameKind, string> = { snowball: SNOWBALL, ski: SKIER };
const big = (k: GameKind, extra = '') => ICON[k].replace(/class="(\w+)"/, `class="$1 big${extra}"`);
const RULES: Record<GameKind, (g: GameState) => string> = {
  snowball: () => `Wie het eerst ${WIN_HITS} keer raakt, wint.`,
  ski: (g) => `Een race naar beneden${g.piste ? ` over een ${esc(g.piste.label)}` : ''}. Tik zo snel je kunt: wie het eerst beneden is, wint.`,
};

type Screen = { update(g: GameState, ev?: GameEvent): void; stop(): void };

export function createGames(opts: { toast(html: string, ms: number): void; stage?: Stage }) {
  /** games this tab plays (it challenged or accepted) */
  const mine = new Set<string>();
  /** games another tab or device of mine plays */
  const elsewhere = new Set<string>();
  /** challenged from this tab, waiting for the room to confirm */
  let pending: { live: Live; to: string; naam: string } | null = null;
  let box: HTMLElement | null = null, boxGame = '', screen: Screen | null = null, inviteT = 0, loadT = 0;

  function overlay(game: string, html: string) {
    close();
    box = document.createElement('div');
    box.className = 'sb';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = html;
    document.body.append(box);
    document.body.classList.add('sbopen');
    boxGame = game;
    return box;
  }
  function close() {
    clearInterval(inviteT);
    clearTimeout(loadT);
    screen?.stop();
    screen = null;
    box?.remove();
    box = null;
    boxGame = '';
    document.body.classList.remove('sbopen');
  }

  /** waiting for the room: a spinning icon, so it's clear something is happening */
  function showLoading(game: string, kind: GameKind, text: string) {
    overlay(game, `<div class="sbcard sbload">${big(kind, ' spin')}<h2>${text}</h2><p>Even geduld…</p></div>`);
    loadT = window.setTimeout(() => {
      pending = null;
      close();
      opts.toast(`${ICON[kind]}<span>Het spel laadt niet. Controleer je verbinding en probeer het nog eens.</span>`, 6000);
    }, 10_000);
  }

  // ---------- choose a game ----------
  function pick(live: Live | undefined, to: string, naam: string) {
    const b = overlay('', `<div class="sbcard">
      <h2>Wat wil je spelen met ${esc(naam)}?</h2>
      <div class="sbpick">
        <button type="button" data-kind="snowball">${big('snowball')}<b>Sneeuwbalgevecht</b><small>Gooien en bukken</small></button>
        <button type="button" data-kind="ski">${big('ski')}<b>Skiwedstrijd</b><small>Snel tikken, naar beneden</small></button>
      </div>
      <div class="sbrow"><button type="button" data-cancel>Toch niet</button></div></div>`);
    b.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((x) => (x.onclick = () => challenge(live, to, naam, x.dataset.kind as GameKind)));
    b.querySelector<HTMLButtonElement>('[data-cancel]')!.onclick = close;
    b.querySelector<HTMLButtonElement>('[data-kind]')!.focus();
    b.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  function challenge(live: Live | undefined, to: string, naam: string, kind: GameKind) {
    if (!live || live.state.status !== 'online') { close(); return opts.toast(`${ICON[kind]}<span>Geen verbinding, probeer het zo nog eens.</span>`, 4000); }
    let piste;
    if (kind === 'ski') {
      const w = opts.stage?.world(live.trip);
      piste = w && pickPiste(w);
      if (!piste) { close(); return opts.toast(`${SKIER}<span>${w ? 'Dit skigebied heeft geen geschikte piste voor een wedstrijd.' : 'De kaart is nog aan het laden. Probeer het zo nog eens.'}</span>`, 5000); }
    }
    pending = { live, to, naam };
    live.challenge(to, kind, piste);
    showLoading('', kind, `Uitdaging naar ${esc(naam)} versturen`);
  }

  // ---------- invite (to me) and waiting (I challenged) ----------
  function showInvite(live: Live, g: GameState) {
    const b = overlay(g.id, `<div class="sbcard">${big(g.kind)}
      <h2>${esc(g.a.naam)} daagt je uit voor ${GAME_WORDS[g.kind].een}!</h2>
      <p>${RULES[g.kind](g)} Doe je mee?</p>
      <p class="sbleft" data-left></p>
      <div class="sbrow"><button type="button" data-no>Nee, nu niet</button><button type="button" class="primary" data-yes>Ja, doe ik!</button></div></div>`);
    countdown(b, g.left);
    b.querySelector<HTMLButtonElement>('[data-yes]')!.onclick = () => { mine.add(g.id); live.answer(g.id, true); showLoading(g.id, g.kind, `${g.kind === 'ski' ? 'Skiwedstrijd' : 'Sneeuwbalgevecht'} laden`); };
    b.querySelector<HTMLButtonElement>('[data-no]')!.onclick = () => { live.answer(g.id, false); close(); };
    b.querySelector<HTMLButtonElement>('[data-yes]')!.focus();
    navigator.vibrate?.([120, 80, 120]);
  }
  function showWaiting(live: Live, g: GameState) {
    const b = overlay(g.id, `<div class="sbcard">${big(g.kind)}
      <h2>Je hebt ${esc(g.b.naam)} uitgedaagd</h2>
      <p>${g.piste ? `${esc(g.piste.label[0].toUpperCase() + g.piste.label.slice(1))}. ` : ''}Even wachten tot ${esc(g.b.naam)} ja zegt…</p>
      <p class="sbleft" data-left></p>
      <div class="sbrow"><button type="button" data-cancel>Toch niet</button></div></div>`);
    countdown(b, g.left);
    b.querySelector<HTMLButtonElement>('[data-cancel]')!.onclick = () => { live.quit(g.id); close(); };
  }
  function countdown(b: HTMLElement, left: number) {
    const end = Date.now() + left, el = b.querySelector('[data-left]')!;
    const tick = () => (el.textContent = `Nog ${Math.max(0, Math.ceil((end - Date.now()) / 1000))} seconden`);
    tick();
    inviteT = window.setInterval(tick, 500);
  }

  // ---------- from the room ----------
  function onGame(live: Live, g: GameState, ev?: GameEvent) {
    const me = live.state.me, iAmA = g.a.id === me, other = iAmA ? g.b : g.a;
    if (g.status === 'invited') {
      if (!iAmA) { if (boxGame !== g.id) showInvite(live, g); }
      else if (pending && pending.to === g.b.id) { pending = null; mine.add(g.id); showWaiting(live, g); }
      else elsewhere.add(g.id); // challenged from another tab or device
      return;
    }
    // a game that's already going, and this tab knows nothing about it: reloaded or reconnected, so pick it up again
    if (!mine.has(g.id) && !elsewhere.has(g.id) && boxGame !== g.id && !box && g.status !== 'over') mine.add(g.id);
    if (!mine.has(g.id)) {
      // another tab or device of mine handles this game
      if (g.status !== 'over') elsewhere.add(g.id); else elsewhere.delete(g.id);
      if (boxGame === g.id) { close(); if (g.status !== 'over') opts.toast(`${ICON[g.kind]}<span>Je speelt tegen <b>${esc(other.naam)}</b> op een ander scherm.</span>`, 5000); }
      return;
    }
    if (g.status === 'over' && !screen) {
      // it ended before it started: declined, no answer, withdrawn, someone left
      mine.delete(g.id);
      close();
      const text = { declined: `${esc(other.naam)} wil nu even niet.`, expired: `${esc(other.naam)} reageerde niet.`, cancelled: `${esc(other.naam)} trok de uitdaging in.` }[g.end as string] || 'Het spel ging niet door.';
      opts.toast(`${ICON[g.kind]}<span>${text}</span>`, 6000);
      return;
    }
    if (!screen) {
      const b = overlay(g.id, '');
      const done = () => { mine.delete(g.id); close(); }, again = () => { close(); challenge(live, other.id, other.naam, g.kind); };
      screen = g.kind === 'ski' && opts.stage ? skiScreen(b, live, g, opts.stage, done, again) : snowballScreen(b, live, g, done, again);
    }
    screen.update(g, ev);
    if (g.status === 'over') mine.delete(g.id);
  }

  return {
    onGame,
    /** the button after someone's name: choose a game, then challenge */
    pick,
    /** something's on screen (no toasts about games then) */
    busy: () => !!box,
    onError(error: string) { pending = null; if (box && !screen) close(); opts.toast(`${SNOWBALL}<span>${esc(error)}</span>`, 5000); },
  };
}
