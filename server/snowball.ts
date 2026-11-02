// Snowball fights inside a trip's room. The room is the referee: it decides what hits, the browsers only press buttons.
// Games live in memory: they're short, and the pending timers keep a Durable Object awake while one is going on.
import type { ServerMsg } from '../shared/live.ts';
import {
  COUNTDOWN_MS, DUCK_COOLDOWN_MS, DUCK_MS, FLIGHT_MS, GAME_MS, GONE_MS, INVITE_MS, RELOAD_MS, WIN_HITS,
  type GameAction, type GameEnd, type GameEvent, type GameState, type Player,
} from '../shared/snowball.ts';

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
  reloadAt: Record<string, number>;
  duckUntil: Record<string, number>;
  duckAt: Record<string, number>;
  timers: Set<ReturnType<typeof setTimeout>>;
}

const ACTIVE = new Set(['invited', 'countdown', 'playing']);

export class Snowball {
  private games = new Map<string, Game>();
  private n = 0;

  constructor(private host: GamesHost) {}

  /** the game someone is in (or invited to), if any */
  private gameOf(userId: string) {
    for (const g of this.games.values()) if (ACTIVE.has(g.status) && (g.a.id === userId || g.b.id === userId)) return g;
    return null;
  }

  challenge(from: Player, to: string): string | null {
    if (to === from.id) return 'Jezelf uitdagen gaat lastig.';
    const naam = this.host.online(to);
    if (!naam) return 'Die is nu niet online.';
    if (this.gameOf(from.id)) return 'Je bent al met een sneeuwbalgevecht bezig.';
    if (this.gameOf(to)) return `${naam} is al met een sneeuwbalgevecht bezig.`;
    const g: Game = {
      id: Date.now().toString(36) + (this.n++).toString(36), a: from, b: { id: to, naam }, status: 'invited',
      hits: { [from.id]: 0, [to]: 0 }, until: Date.now() + INVITE_MS,
      reloadAt: {}, duckUntil: {}, duckAt: {}, timers: new Set(),
    };
    this.games.set(g.id, g);
    this.later(g, INVITE_MS, () => g.status === 'invited' && this.finish(g, null, 'expired'));
    this.host.system(`❄ ${from.naam} daagt ${naam} uit voor een sneeuwbalgevecht!`);
    this.send(g);
    return null;
  }

  answer(userId: string, id: string, accept: boolean) {
    const g = this.games.get(id);
    if (!g || g.status !== 'invited' || g.b.id !== userId) return;
    if (!accept) return this.finish(g, null, 'declined');
    g.status = 'countdown';
    g.until = Date.now() + COUNTDOWN_MS;
    this.host.system(`❄ ${g.b.naam} neemt de uitdaging van ${g.a.naam} aan. Gooien maar!`);
    this.send(g);
    this.later(g, COUNTDOWN_MS, () => {
      g.status = 'playing';
      g.until = Date.now() + GAME_MS;
      this.send(g);
      this.later(g, GAME_MS, () => {
        const [ha, hb] = [g.hits[g.a.id], g.hits[g.b.id]];
        this.finish(g, ha === hb ? null : ha > hb ? g.a.id : g.b.id, 'time');
      });
    });
  }

  play(userId: string, id: string, a: GameAction) {
    const g = this.games.get(id);
    if (!g || g.status !== 'playing' || (g.a.id !== userId && g.b.id !== userId)) return;
    const now = Date.now(), other = g.a.id === userId ? g.b.id : g.a.id;
    if (a === 'duck') {
      if (now < (g.duckAt[userId] || 0)) return;
      g.duckUntil[userId] = now + DUCK_MS;
      g.duckAt[userId] = now + DUCK_COOLDOWN_MS;
      return this.send(g, { k: 'duck', by: userId, ms: DUCK_MS });
    }
    // throwing: not while reloading or ducking
    if (now < (g.reloadAt[userId] || 0) || now < (g.duckUntil[userId] || 0)) return;
    g.reloadAt[userId] = now + RELOAD_MS;
    this.send(g, { k: 'throw', by: userId, flight: FLIGHT_MS });
    this.later(g, FLIGHT_MS, () => {
      if (g.status !== 'playing') return;
      if (Date.now() < (g.duckUntil[other] || 0)) return this.send(g, { k: 'miss', on: other });
      g.hits[userId]++;
      this.send(g, { k: 'hit', on: other });
      if (g.hits[userId] >= WIN_HITS) this.finish(g, userId, 'score');
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
    const score = (w: string) => `${g.hits[w]}–${g.hits[w === g.a.id ? g.b.id : g.a.id]}`;
    const loser = winner && (winner === g.a.id ? g.b.id : g.a.id);
    this.host.system({
      declined: `${g.b.naam} slaat de uitdaging van ${g.a.naam} af.`,
      expired: `${g.b.naam} reageerde niet op de uitdaging van ${g.a.naam}.`,
      cancelled: `${g.a.naam} trekt de uitdaging aan ${g.b.naam} in.`,
      score: winner ? `🏆 ${naam(winner)} wint het sneeuwbalgevecht van ${naam(loser!)} met ${score(winner)}!` : '',
      time: winner ? `🏆 ${naam(winner)} wint het sneeuwbalgevecht van ${naam(loser!)} met ${score(winner)} (tijd op).` : `Het sneeuwbalgevecht tussen ${g.a.naam} en ${g.b.naam} eindigt gelijk (${g.hits[g.a.id]}–${g.hits[g.b.id]}).`,
      quit: `🏆 ${naam(loser!)} geeft op: ${naam(winner!)} wint het sneeuwbalgevecht.`,
      left: `🏆 ${naam(loser!)} is weg: ${naam(winner!)} wint het sneeuwbalgevecht.`,
    }[end]);
  }

  private later(g: Game, ms: number, fn: () => void) {
    const t = setTimeout(() => { g.timers.delete(t); fn(); }, ms);
    g.timers.add(t);
  }

  private view(g: Game): GameState {
    const { id, a, b, status, hits, winner, end } = g;
    return { id, a, b, status, hits, winner, end, left: Math.max(0, g.until - Date.now()) };
  }

  private send(g: Game, ev?: GameEvent) {
    const msg: ServerMsg = { t: 'game', game: this.view(g), ev };
    this.host.sendTo(g.a.id, msg);
    this.host.sendTo(g.b.id, msg);
  }
}
