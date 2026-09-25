import { fold, words, expandAlias } from './normalize.js';
import { JUNK_NAME } from './wikitext.js';

// Searchable categories. `key` is the song field; each field holds an array of strings
// (title/film are wrapped so everything is handled uniformly).
export const FIELDS = [
  { key: 'title', label: 'Song title', placeholder: 'e.g. Kadhal Rojave' },
  { key: 'film', label: 'Movie', placeholder: 'e.g. Roja' },
  { key: 'actors', label: 'Actor / actress', placeholder: 'e.g. Rajinikanth, Meena' },
  { key: 'musicDirectors', label: 'Music director', placeholder: 'e.g. Ilaiyaraaja' },
  { key: 'lyricists', label: 'Lyricist', placeholder: 'e.g. Vairamuthu' },
  { key: 'singers', label: 'Singer', placeholder: 'e.g. SPB, Janaki' },
  { key: 'directors', label: 'Movie director', placeholder: 'e.g. Mani Ratnam' },
];

const LIST_KEYS = FIELDS.map((f) => f.key);

// Flatten film records (with nested songs) into one row per song. Song-level values
// override film-level ones (e.g. a film with several lyricists).
export function flattenFilms(films, source = '') {
  const songs = [];
  for (const f of films) {
    for (const s of f.songs ?? []) {
      const pick = (k) => (s[k]?.length ? s[k] : f[k]) ?? [];
      songs.push({
        title: s.title,
        film: f.film,
        year: f.year ?? null,
        actors: pick('actors'),
        musicDirectors: pick('musicDirectors'),
        lyricists: pick('lyricists'),
        singers: s.singers ?? [],
        directors: pick('directors'),
        length: s.length ?? '',
        wiki: f.wiki ?? '',
        source: f.source ?? source,
      });
    }
  }
  return songs;
}

const PEOPLE = ['actors', 'musicDirectors', 'lyricists', 'singers', 'directors'];

// Wikipedia spells the same person many ways ("Vaali" / "Vaalee", "K. S. Chithra" /
// "K.S. Chitra" / "Chithra"). Unify each name to its most common spelling so results and
// facets don't split one person in two. Names that fold to the same key are merged; a
// bare name ("Janaki") joins an initialed one ("S. Janaki") only when, within that field,
// exactly one initialed form exists and it is at least as common.
const INITIALS = /^((?:[A-Z][a-z]?\.\s*)+)(.+)$/;

// Key for "same person": initials stay separate from the folded name so "A. Hariharan"
// never collapses into "Hariharan", while "S.P. Balasubrahmanyam" == "S. P. Balasubramanyam".
function nameKey(v) {
  const m = v.trim().match(INITIALS);
  return m ? `${m[1].replace(/[^A-Za-z]/g, '').toLowerCase()}|${fold(m[2])}` : `|${fold(v)}`;
}

export function canonicalize(songs) {
  const counts = new Map(); // key → Map(spelling → n)
  for (const s of songs) {
    for (const k of PEOPLE) {
      for (const raw of s[k]) {
        const v = raw.trim();
        const key = nameKey(v);
        if (!counts.has(key)) counts.set(key, new Map());
        counts.get(key).set(v, (counts.get(key).get(v) ?? 0) + 1);
      }
    }
  }
  const best = new Map();
  const total = new Map();
  for (const [key, spellings] of counts) {
    let top = null;
    let n = 0;
    for (const [v, c] of spellings) {
      n += c;
      // Prefer the most common; on ties prefer the proper-cased, longer (punctuated) form.
      if (!top || c > top[1] || (c === top[1] && /^[A-Z]/.test(v) && v.length > top[0].length)) top = [v, c];
    }
    best.set(key, top[0]);
    total.set(key, n);
  }

  const bareTo = {};
  for (const k of PEOPLE) {
    const byBare = new Map(); // bare key → Set(full keys)
    for (const s of songs) {
      for (const v of s[k]) {
        const key = nameKey(v);
        if (key.startsWith('|')) continue;
        const bare = `|${key.split('|')[1]}`;
        if (!byBare.has(bare)) byBare.set(bare, new Set());
        byBare.get(bare).add(key);
      }
    }
    bareTo[k] = new Map();
    for (const [bare, fulls] of byBare) {
      if (fulls.size !== 1 || !total.has(bare)) continue;
      const [full] = fulls;
      if (total.get(full) >= total.get(bare)) bareTo[k].set(bare, full);
    }
  }

  return songs.map((s) => {
    const out = { ...s };
    for (const k of PEOPLE) {
      const seen = new Set();
      out[k] = [];
      for (const v of s[k]) {
        if (JUNK_NAME.test(v.trim())) continue;
        let key = nameKey(v);
        key = bareTo[k].get(key) ?? key;
        const name = best.get(key) ?? v;
        if (!seen.has(name)) { seen.add(name); out[k].push(name); }
      }
    }
    return out;
  });
}

// Songs appear once per source; drop duplicates of the same (film, year, title),
// merging any fields the duplicate knows that the first copy did not.
export function dedupe(songs) {
  const byKey = new Map();
  for (const s of songs) {
    const key = `${fold(s.film)}|${s.year ?? ''}|${fold(s.title)}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...s });
      continue;
    }
    for (const k of LIST_KEYS.slice(2)) {
      if (!prev[k]?.length && s[k]?.length) prev[k] = s[k];
    }
    if (!prev.wiki && s.wiki) prev.wiki = s.wiki;
  }
  return [...byKey.values()];
}

// Precompute folded keys once per song so filtering stays fast on large libraries.
export function index(songs) {
  return songs.map((s) => {
    const keys = {};
    for (const k of LIST_KEYS) {
      const vals = k === 'title' || k === 'film' ? [s[k]] : s[k];
      keys[k] = vals.map((v) => ({ whole: fold(v), words: words(v) }));
    }
    keys.all = Object.values(keys).flat();
    return { song: s, keys };
  });
}

// A single term matches a value when the whole folded term is a substring of the value,
// or every word of the term starts some word of the value ("rah" → "A. R. Rahman").
function termMatches(term, values) {
  const whole = fold(term);
  if (!whole) return true;
  const qWords = words(term);
  return values.some(
    (v) => v.whole.includes(whole) || qWords.every((q) => v.words.some((w) => w.startsWith(q))),
  );
}

// Comma-separated terms inside one field must ALL match (e.g. singers "SPB, Janaki").
export function parseTerms(input) {
  return String(input ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map(expandAlias);
}

/**
 * query: { title, film, actors, musicDirectors, lyricists, singers, directors,
 *          any, yearFrom, yearTo }
 */
export function search(indexed, query) {
  const active = LIST_KEYS.map((k) => [k, parseTerms(query[k])]).filter(([, t]) => t.length);
  const anyTerms = String(query.any ?? '').trim().split(/\s+/).filter(Boolean).map(expandAlias);
  const from = Number(query.yearFrom) || -Infinity;
  const to = Number(query.yearTo) || Infinity;

  return indexed
    .filter(({ song, keys }) => {
      if (song.year != null && (song.year < from || song.year > to)) return false;
      if (song.year == null && (query.yearFrom || query.yearTo)) return false;
      for (const [k, terms] of active) {
        if (!terms.every((t) => termMatches(t, keys[k]))) return false;
      }
      return anyTerms.every((t) => termMatches(t, keys.all));
    })
    .map(({ song }) => song);
}

export function isEmptyQuery(query) {
  return !LIST_KEYS.some((k) => String(query[k] ?? '').trim()) &&
    !String(query.any ?? '').trim() && !query.yearFrom && !query.yearTo;
}

// Count values of a field across results, for the "refine" facets.
export function facet(songs, key, limit = 8) {
  const counts = new Map();
  for (const s of songs) {
    const vals = key === 'film' ? [s.film] : s[key];
    for (const v of new Set(vals)) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

// All distinct values of a field (for autocomplete).
export function distinct(songs, key) {
  const set = new Set();
  for (const s of songs) for (const v of key === 'title' || key === 'film' ? [s[key]] : s[key]) set.add(v);
  return [...set].sort((a, b) => a.localeCompare(b));
}
