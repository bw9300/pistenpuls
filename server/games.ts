// Mini games inside a trip's room. The room is the referee: it decides what hits and who's down first,
// the browsers only press buttons. Games live in memory: they're short, and the pending timers keep
// a Durable Object awake while one is going on.
import type { ServerMsg } from '../shared/live.ts';
import { COUNTDOWN_MS, GAME_WORDS, GONE_MS, INVITE_MS, LOAD_MS, type GameAction, type GameEnd, type GameEvent, type GameKind, type GameState, type PisteRef, type Player } from '../shared/games.ts';
import { DUCK_COOLDOWN_MS, DUCK_MS, FLIGHT_MS, GAME_MS, RELOAD_MS, WIN_HITS } from '../shared/snowball.ts';
import { MIN_TAP_MS, SKI_MS, SKI_TAPS } from '../shared/ski.ts';

export interface GamesHost {
  /** the name of someone who is in the room now, else null */
  online(userId: string): string | null;
  sendTo(userId: string, msg: ServerMsg): void;
  /** a line in the chat from Pistenpuls itself */
  system(text: string): void;
}

interface Game extends Omit<GameState, 'left'> {
  /** when the current step ends (answer deadline, start, end) */
  until: number;
  started: number;
  timers: Set<ReturnType<typeof setTimeout>>;
  // snowball
  reloadAt: Record<string, number>;
  duckUntil: Record<string, number>;
  duckAt: Record<string, number>;
  // ski
  lastTap: Record<string, number>;
  dirty: boolean;
  ready: string[];
}

const ACTIVE = new Set(['invited', 'loading', 'countdown', 'playing']);
const LENGTH: Record<GameKind, number> = { snowball: GAME_MS, ski: SKI_MS };
const secs = (ms: number) => (ms / 1000).toFixed(1).replace('.', ',') + ' s';

export class Games {
  private games = new Map<string, Game>();
  private n = 0;

  constructor(private host: GamesHost) {}

  /** the game someone is in (or invited to), if any */
  private gameOf(userId: string) {
    for (const g of this.games.values()) if (ACTIVE.has(g.status) && (g.a.id === userId || g.b.id === userId)) return g;
    return null;
  }

  challenge(from: Player, to: string, kind: GameKind, piste?: PisteRef): string | null {
    if (to === from.id) return 'Jezelf uitdagen gaat lastig.';
    const naam = this.host.online(to);
    if (!naam) return 'Die is nu niet online.';
    if (this.gameOf(from.id)) return 'Je bent al met een spelletje bezig.';
    if (this.gameOf(to)) return `${naam} is al met een spelletje bezig.`;
    if (kind === 'ski' && !piste) return 'Geen piste gekozen.';
    const g: Game = {
      id: Date.now().toString(36) + (this.n++).toString(36), kind, a: from, b: { id: to, naam }, status: 'invited',
      score: { [from.id]: 0, [to]: 0 }, piste: kind === 'ski' ? piste : undefined, until: Date.now() + INVITE_MS, started: 0,
      timers: new Set(), reloadAt: {}, duckUntil: {}, duckAt: {}, lastTap: {}, dirty: false, ready: [],
    };
    this.games.set(g.id, g);
    this.later(g, INVITE_MS, () => g.status === 'invited' && this.finish(g, null, 'expired'));
    const w = GAME_WORDS[kind];
    this.host.system(`${w.icon} ${from.naam} daagt ${naam} uit voor ${w.een}${piste ? ` (${piste.label})` : ''}!`);
    this.send(g);
    return null;
  }

  answer(userId: string, id: string, accept: boolean) {
    const g = this.games.get(id);
    if (!g || g.status !== 'invited' || g.b.id !== userId) return;
    if (!accept) return this.finish(g, null, 'declined');
    g.status = 'loading';
    g.until = Date.now() + LOAD_MS;
    this.host.system(`${GAME_WORDS[g.kind].icon} ${g.b.naam} neemt de uitdaging van ${g.a.naam} aan. ${g.kind === 'ski' ? 'Daar gaan ze!' : 'Gooien maar!'}`);
    this.send(g);
    // someone's browser is slow: start anyway
    this.later(g, LOAD_MS, () => g.status === 'loading' && this.countdown(g));
  }

  /** a browser has everything it needs (map, photos) */
  private ready(g: Game, userId: string) {
    if (g.status !== 'loading' || g.ready.includes(userId)) return;
    g.ready.push(userId);
    if (g.ready.length === 2) this.countdown(g);
    else this.send(g);
  }

  private countdown(g: Game) {
    g.status = 'countdown';
    g.until = Date.now() + COUNTDOWN_MS;
    this.send(g);
    this.later(g, COUNTDOWN_MS, () => {
      g.status = 'playing';
      g.started = Date.now();
      g.until = g.started + LENGTH[g.kind];
      this.send(g);
      if (g.kind === 'ski') this.tick(g);
      this.later(g, LENGTH[g.kind], () => {
        const [sa, sb] = [g.score[g.a.id], g.score[g.b.id]];
        this.finish(g, sa === sb ? null : sa > sb ? g.a.id : g.b.id, 'time');
      });
    });
  }

  play(userId: string, id: string, a: GameAction) {
    const g = this.games.get(id);
    if (!g || (g.a.id !== userId && g.b.id !== userId)) return;
    if (a === 'ready') return this.ready(g, userId);
    if (g.status !== 'playing') return;
    if (g.kind === 'ski') { if (a === 'push') this.push(g, userId); return; }
    const now = Date.now(), other = g.a.id === userId ? g.b.id : g.a.id;
    if (a === 'duck') {
      if (now < (g.duckAt[userId] || 0)) return;
      g.duckUntil[userId] = now + DUCK_MS;
      g.duckAt[userId] = now + DUCK_COOLDOWN_MS;
      return this.send(g, { k: 'duck', by: userId, ms: DUCK_MS });
    }
    if (a !== 'throw') return;
    // throwing: not while reloading or ducking
    if (now < (g.reloadAt[userId] || 0) || now < (g.duckUntil[userId] || 0)) return;
    g.reloadAt[userId] = now + RELOAD_MS;
    this.send(g, { k: 'throw', by: userId, flight: FLIGHT_MS });
    this.later(g, FLIGHT_MS, () => {
      if (g.status !== 'playing') return;
      if (Date.now() < (g.duckUntil[other] || 0)) return this.send(g, { k: 'miss', on: other });
      g.score[userId]++;
      this.send(g, { k: 'hit', on: other });
      if (g.score[userId] >= WIN_HITS) this.finish(g, userId, 'score');
    });
  }

  // ---------- ski: every tap a bit further; positions go out 10× per second ----------
  private push(g: Game, userId: string) {
    const now = Date.now();
    if (now - (g.lastTap[userId] || 0) < MIN_TAP_MS) return;
    g.lastTap[userId] = now;
    g.score[userId] = Math.min(SKI_TAPS, g.score[userId] + 1);
    g.dirty = true;
    if (g.score[userId] >= SKI_TAPS) { g.time = now - g.started; this.finish(g, userId, 'finish'); }
  }
  private tick(g: Game) {
    this.later(g, 100, () => {
      if (g.status !== 'playing') return;
      if (g.dirty) { g.dirty = false; this.send(g); }
      this.tick(g);
    });
  }

  quit(userId: string, id: string) {
    const g = this.games.get(id);
    if (!g || !ACTIVE.has(g.status)) return;
    if (g.status === 'invited') {
      if (g.a.id === userId) this.finish(g, null, 'cancelled');
      else if (g.b.id === userId) this.finish(g, null, 'declined');
      return;
    }
    if (g.a.id === userId) this.finish(g, g.b.id, 'quit');
    else if (g.b.id === userId) this.finish(g, g.a.id, 'quit');
  }

  /** someone's last connection to this room closed: if they don't come back soon, they lose */
  gone(userId: string) {
    const g = this.gameOf(userId);
    if (!g) return;
    this.later(g, GONE_MS, () => {
      if (!ACTIVE.has(g.status) || this.host.online(userId)) return;
      const other = g.a.id === userId ? g.b.id : g.a.id;
      if (g.status === 'invited') this.finish(g, null, g.a.id === userId ? 'cancelled' : 'expired');
      else this.finish(g, other, 'left');
    });
  }

  /** after a reconnect: show the game again */
  resend(userId: string) {
    const g = this.gameOf(userId);
    if (g) this.host.sendTo(userId, { t: 'game', game: this.view(g) });
  }

  private finish(g: Game, winner: string | null, end: GameEnd) {
    for (const t of g.timers) clearTimeout(t);
    g.timers.clear();
    g.status = 'over';
    g.winner = winner;
    g.end = end;
    g.until = Date.now();
    this.send(g);
    this.games.delete(g.id);
    const naam = (id: string) => (id === g.a.id ? g.a.naam : g.b.naam);
    const loser = winner && (winner === g.a.id ? g.b.id : g.a.id);
    const score = (w: string) => `${g.score[w]}–${g.score[w === g.a.id ? g.b.id : g.a.id]}`;
    const { de } = GAME_WORDS[g.kind];
    const ski = g.kind === 'ski';
    this.host.system({
      declined: `${g.b.naam} slaat de uitdaging van ${g.a.naam} af.`,
      expired: `${g.b.naam} reageerde niet op de uitdaging van ${g.a.naam}.`,
      cancelled: `${g.a.naam} trekt de uitdaging aan ${g.b.naam} in.`,
      score: winner ? `🏆 ${naam(winner)} wint ${de} van ${naam(loser!)} met ${score(winner)}!` : '',
      finish: winner ? `🏆 ${naam(winner)} wint ${de} van ${naam(loser!)}: in ${secs(g.time || 0)} beneden!` : '',
      time: winner
        ? `🏆 ${naam(winner)} wint ${de} van ${naam(loser!)} ${ski ? '(verst gekomen)' : `met ${score(winner)} (tijd op)`}.`
        : `${de[0].toUpperCase() + de.slice(1)} tussen ${g.a.naam} en ${g.b.naam} eindigt gelijk${ski ? '' : ` (${g.score[g.a.id]}–${g.score[g.b.id]})`}.`,
      quit: `🏆 ${naam(loser!)} geeft op: ${naam(winner!)} wint ${de}.`,
      left: `🏆 ${naam(loser!)} is weg: ${naam(winner!)} wint ${de}.`,
    }[end]);
  }

  private later(g: Game, ms: number, fn: () => void) {
    const t = setTimeout(() => { g.timers.delete(t); fn(); }, ms);
    g.timers.add(t);
  }

  private view(g: Game): GameState {
    const { id, kind, a, b, status, score, piste, winner, end, time, ready } = g;
    return { id, kind, a, b, status, score, piste, winner, end, time, ready, left: Math.max(0, g.until - Date.now()) };
  }

  private send(g: Game, ev?: GameEvent) {
    const msg: ServerMsg = { t: 'game', game: this.view(g), ev };
    this.host.sendTo(g.a.id, msg);
    this.host.sendTo(g.b.id, msg);
  }
}
