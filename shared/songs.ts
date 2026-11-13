// The songs of Après-ski King. Each is a folder in songs/: audio.mp3 and song.json (made by tools/song-add.ts).
// A new song: npm run song:add, then one line in SONGS below.
import schuhe from '../songs/schuhe/song.json';

/** a note: [ms from the start of the audio, lane]; lanes 0 bier, 1 Aperol, 2 Jäger */
export type Note = [number, number];

export interface Song {
  id: string;
  titel: string;
  artiest: string;
  bpm: number;
  /** ms: the first beat (the grid for the lines in the background) */
  beat0: number;
  /** ms: the first note (the drop) */
  start: number;
  /** ms: length of the audio */
  duur: number;
  notes: Note[];
}

export const SONGS: Song[] = [schuhe as Song];

export const songById = (id: string | undefined) => SONGS.find((s) => s.id === id);
