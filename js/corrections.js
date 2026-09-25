// Manual corrections layered on top of the Wikipedia data. They live in
// data/corrections.json (shared, committed) and in the browser (your own unsent edits),
// and are re-applied on every load, so they survive dataset rebuilds.
//
// An entry targets a film (by name + optional year) and optionally one song:
//   { "film": "Naalu Veli Nilam", "year": 1959,
//     "set": { "musicDirectors": ["K. V. Mahadevan", "M. K. Athmanathan"] } }
//   { "film": "Naalu Veli Nilam", "year": 1959, "song": "Kaani Nilam Vendum",
//     "set": { "lyricists": ["A. Maruthakasi"] } }
//   { "film": "…", "song": "…", "delete": true }            remove a song
//   { "film": "…", "delete": true }                         remove a film
// A song or film that doesn't exist yet is added.
//
// Film-level credits (musicDirectors, lyricists) replace the per-song values of that
// field too, unless a song has its own correction for it.

import { fold } from './normalize.js';

export const FILM_FIELDS = ['film', 'year', 'directors', 'actors', 'musicDirectors', 'lyricists'];
export const SONG_FIELDS = ['title', 'singers', 'lyricists', 'musicDirectors', 'length'];
const LISTS = new Set(['directors', 'actors', 'musicDirectors', 'lyricists', 'singers']);
const MAX_ITEMS = 40;
const MAX_LEN = 200;

const str = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_LEN;

// Returns a cleaned copy of one correction, or throws with a readable message.
export function validateCorrection(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('correction must be an object');
  if (!str(c.film)) throw new Error('"film" (the movie name) is required');
  const out = { film: c.film.trim() };
  if (c.year != null) {
    const y = Number(c.year);
    if (!Number.isInteger(y) || y < 1900 || y > 2100) throw new Error('"year" must be a year like 1959');
    out.year = y;
  }
  if (c.song != null) {
    if (!str(c.song)) throw new Error('"song" must be a song title');
    out.song = c.song.trim();
  }
  if (c.delete === true) return { ...out, delete: true };
  const allowed = out.song ? SONG_FIELDS : FILM_FIELDS;
  if (!c.set || typeof c.set !== 'object' || Array.isArray(c.set)) throw new Error('"set" with the corrected fields is required');
  out.set = {};
  for (const [k, v] of Object.entries(c.set)) {
    if (!allowed.includes(k)) throw new Error(`"${k}" can't be set on a ${out.song ? 'song' : 'film'}; allowed: ${allowed.join(', ')}`);
    if (LISTS.has(k)) {
      if (!Array.isArray(v) || v.length > MAX_ITEMS || !v.every((x) => str(x))) throw new Error(`"${k}" must be a list of names`);
      out.set[k] = v.map((x) => x.trim());
    } else if (k === 'year') {
      const y = Number(v);
      if (!Number.isInteger(y) || y < 1900 || y > 2100) throw new Error('"year" must be a year like 1959');
      out.set.year = y;
    } else if (k === 'length') {
      if (typeof v !== 'string' || v.length > 20) throw new Error('"length" must be text like 3:21');
      out.set.length = v.trim();
    } else {
      if (!str(v)) throw new Error(`"${k}" must be text`);
      out.set[k] = v.trim();
    }
  }
  if (!Object.keys(out.set).length) throw new Error('nothing to change');
  return out;
}

const sameFilm = (f, c) => fold(f.film) === fold(c.film) && (c.year == null || f.year == null || f.year === c.year);

/** Apply corrections (in order) to film records; returns new records, inputs untouched. */
export function applyCorrections(films, corrections) {
  if (!corrections?.length) return films;
  const out = films.map((f) => ({ ...f, songs: (f.songs ?? []).map((s) => ({ ...s })) }));
  const removed = new Set();
  const songOwned = new WeakMap(); // song → Set(fields set by a song-level correction)

  for (const raw of corrections) {
    let c;
    try { c = validateCorrection(raw); } catch { continue; }
    let targets = out.filter((f) => !removed.has(f) && sameFilm(f, c));
    if (!targets.length) {
      if (c.delete) continue;
      const created = { film: c.film, year: c.year ?? null, directors: [], actors: [], musicDirectors: [], songs: [], source: 'Correction' };
      out.push(created);
      targets = [created];
    }
    for (const f of targets) {
      if (!c.song) {
        if (c.delete) { removed.add(f); continue; }
        Object.assign(f, c.set);
        for (const k of ['musicDirectors', 'lyricists']) {
          if (!c.set[k]) continue;
          for (const s of f.songs) if (!songOwned.get(s)?.has(k)) delete s[k];
        }
        continue;
      }
      const key = fold(c.song);
      const idx = f.songs.findIndex((s) => fold(s.title) === key);
      if (c.delete) { if (idx !== -1) f.songs.splice(idx, 1); continue; }
      let song = f.songs[idx];
      if (!song) {
        song = { title: c.song, singers: [] };
        f.songs.push(song);
      }
      Object.assign(song, c.set);
      if (!songOwned.has(song)) songOwned.set(song, new Set());
      for (const k of Object.keys(c.set)) songOwned.get(song).add(k);
    }
  }
  return out.filter((f) => !removed.has(f));
}
