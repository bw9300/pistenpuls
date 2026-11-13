// Après-ski King: drinks slide down the bar to the beat of a song; tap the right one as it reaches the coaster.
// Each browser plays the song and judges its own taps (a round trip to the room would make every tap late);
// the room checks each judgement is possible and keeps the score (server/games.ts). Songs: shared/songs.ts.

export const LANES = [
  { id: 'bier', naam: 'Bier', kleur: '#F2B233' },
  { id: 'aperol', naam: 'Aperol', kleur: '#F26B1D' },
  { id: 'jager', naam: 'Jäger', kleur: '#3E9A5A' },
] as const;

/** a tap this close to the note (ms, either side) is perfect, this close good; later than GOOD_MS it's missed */
export const PERFECT_MS = 60;
export const GOOD_MS = 130;
/** judgements: 0 missed, 1 good, 2 perfect */
export type Judgement = 0 | 1 | 2;
export const POINTS = [0, 50, 100];
/** every COMBO_STEP in a row one more multiplier, up to MAX_MULT */
export const COMBO_STEP = 10;
export const MAX_MULT = 4;
export const mult = (combo: number) => Math.min(MAX_MULT, 1 + Math.floor(combo / COMBO_STEP));
/** how long a drink is on its way down the bar */
export const LEAD_MS = 1800;
/** the game runs this much longer than the song (late connections, the last note's window) */
export const END_PAD_MS = 1500;
/** the room accepts a hit this early (ms before the note, by its own clock); browsers start a little after the room */
export const EARLY_MS = 400;

/** per player: score, combo, best combo, perfect/good/missed */
export interface Tally { score: number; combo: number; best: number; n: [number, number, number] }
export const newTally = (): Tally => ({ score: 0, combo: 0, best: 0, n: [0, 0, 0] });

/** the same on both sides: browser (instant) and room (counts) */
export function tally(t: Tally, j: Judgement) {
  t.n[2 - j]++;
  if (!j) { t.combo = 0; return; }
  t.combo++;
  t.best = Math.max(t.best, t.combo);
  t.score += POINTS[j] * mult(t.combo);
}
