// Snowball fight: press THROW, the ball flies FLIGHT_MS. Is the other one ducking when it lands? Miss. Otherwise: hit.
// First to WIN_HITS hits wins; after GAME_MS the one with most hits wins (or it's a draw).
// Ducking lasts DUCK_MS and can only be done again after DUCK_COOLDOWN_MS, so two quick balls beat a duck.

export const WIN_HITS = 3;
export const FLIGHT_MS = 1100;
export const RELOAD_MS = 1200;
export const DUCK_MS = 800;
export const DUCK_COOLDOWN_MS = 2000;
export const GAME_MS = 60_000;
