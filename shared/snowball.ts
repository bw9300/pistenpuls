// Snowball fight: two people of the same trip, live. The room (server/snowball.ts) is the referee,
// the browser (src/snowball.ts) only shows it and sends button presses.
//
// Rules: press THROW, the ball flies FLIGHT_MS. Is the other one ducking when it lands? Miss. Otherwise: hit.
// First to WIN_HITS hits wins; after GAME_MS the one with most hits wins (or it's a draw).
// Ducking lasts DUCK_MS and can only be done again after DUCK_COOLDOWN_MS, so two quick balls beat a duck.

export const WIN_HITS = 3;
export const FLIGHT_MS = 1100;
export const RELOAD_MS = 1200;
export const DUCK_MS = 800;
export const DUCK_COOLDOWN_MS = 2000;
export const GAME_MS = 60_000;
export const INVITE_MS = 30_000;
export const COUNTDOWN_MS = 3000;
/** a player whose connection is gone this long loses */
export const GONE_MS = 8000;

export interface Player { id: string; naam: string }

export type GameStatus = 'invited' | 'countdown' | 'playing' | 'over';
export type GameEnd = 'score' | 'time' | 'quit' | 'left' | 'declined' | 'expired' | 'cancelled';

export interface GameState {
  id: string;
  /** a challenged b */
  a: Player;
  b: Player;
  status: GameStatus;
  hits: Record<string, number>;
  /** ms until the next step: answer deadline, start, or end of the game */
  left: number;
  winner?: string | null;
  end?: GameEnd;
}

export type GameEvent =
  | { k: 'throw'; by: string; flight: number }
  | { k: 'duck'; by: string; ms: number }
  | { k: 'hit'; on: string }
  | { k: 'miss'; on: string };

export type GameAction = 'throw' | 'duck';
