// Mini games between two people of the same trip, live. The room (server/games.ts) is the referee,
// the browser (src/games.ts + one file per game) only shows it and sends button presses.
// Rules per game: shared/snowball.ts, shared/ski.ts.

export type GameKind = 'snowball' | 'ski';

/** for the chat lines: 'het sneeuwbalgevecht' / 'een skiwedstrijd' */
export const GAME_WORDS: Record<GameKind, { de: string; een: string; icon: string }> = {
  snowball: { de: 'het sneeuwbalgevecht', een: 'een sneeuwbalgevecht', icon: '❄' },
  ski: { de: 'de skiwedstrijd', een: 'een skiwedstrijd', icon: '⛷' },
};

export const INVITE_MS = 30_000;
export const COUNTDOWN_MS = 3000;
/** after 'yes' both browsers get ready (map, photos); the countdown starts when both are, or after this long */
export const LOAD_MS = 15_000;
/** a player whose connection is gone this long loses */
export const GONE_MS = 8000;

export interface Player { id: string; naam: string }

/** ski: which piste (index in the area's runs, the same for everyone on this trip) and how to call it */
export interface PisteRef { i: number; label: string }

export type GameStatus = 'invited' | 'loading' | 'countdown' | 'playing' | 'over';
export type GameEnd = 'score' | 'finish' | 'time' | 'quit' | 'left' | 'declined' | 'expired' | 'cancelled';

export interface GameState {
  id: string;
  kind: GameKind;
  /** a challenged b */
  a: Player;
  b: Player;
  status: GameStatus;
  /** snowball: hits; ski: taps so far */
  score: Record<string, number>;
  /** ski */
  piste?: PisteRef;
  /** ms until the next step: answer deadline, start, or end of the game */
  left: number;
  winner?: string | null;
  end?: GameEnd;
  /** ski: the winner's time in ms */
  time?: number;
  /** loading: who is ready to start */
  ready?: string[];
}

export type GameEvent =
  | { k: 'throw'; by: string; flight: number }
  | { k: 'duck'; by: string; ms: number }
  | { k: 'hit'; on: string }
  | { k: 'miss'; on: string };

export type GameAction = 'ready' | 'throw' | 'duck' | 'push';
