import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flattenFilms, dedupe, index, search, facet } from '../js/search.js';
import { fold } from '../js/normalize.js';

const seed = JSON.parse(readFileSync(new URL('../data/seed.json', import.meta.url)));
const songs = dedupe(flattenFilms(seed.films));
const idx = index(songs);
const titles = (q) => search(idx, q).map((s) => s.title).sort();

test('seed data is well-formed', () => {
  for (const f of seed.films) {
    assert.ok(f.film && Number.isInteger(f.year), f.film);
    assert.ok(f.musicDirectors?.length, `${f.film} music director`);
    for (const s of f.songs) assert.ok(s.title && Array.isArray(s.singers), `${f.film}: ${s.title}`);
  }
});

test('fold treats Tamil romanisation variants as equal', () => {
  assert.equal(fold('Ilayaraja'), fold('Ilaiyaraaja'));
  assert.equal(fold('Kaadhal'), fold('Kadhal'));
  assert.equal(fold('Vairamuthu'), fold('Vairamuttu'));
  assert.equal(fold('AR Rahman'), fold('A. R. Rahman'));
});

test('combines several categories', () => {
  const r = titles({ musicDirectors: 'rahman', directors: 'mani ratnam', singers: 'hariharan' });
  assert.ok(r.includes('Uyire Uyire'));
  assert.ok(r.every((t) => songs.find((s) => s.title === t).directors.includes('Mani Ratnam')));
});

test('comma-separated names are all required; aliases expand', () => {
  const r = titles({ singers: 'SPB, Janaki' });
  assert.ok(r.includes('Panivizhum Iravu'));
  assert.ok(!r.includes('Nilaave Vaa'));
});

test('actors, lyricist and year range', () => {
  const r = search(idx, { actors: 'rajini', lyricists: 'vaali', yearFrom: '1990', yearTo: '1992' });
  assert.ok(r.length > 0);
  assert.ok(r.every((s) => s.film === 'Thalapathi'));
});

test('free text searches all fields', () => {
  const r = titles({ any: 'ilayaraja kamal' });
  assert.ok(r.includes('Kanmani Anbodu Kadhalan'));
});

test('no match returns empty', () => {
  assert.deepEqual(titles({ film: 'Roja', singers: 'Yesudas' }), []);
});

test('facets count values', () => {
  const [[top]] = facet(songs, 'musicDirectors', 1);
  assert.ok(['A. R. Rahman', 'Ilaiyaraaja'].includes(top));
});

test('dedupe merges repeated songs', () => {
  const a = { film: 'Roja', year: 1992, songs: [{ title: 'Kadhal Rojave', singers: [] }] };
  const b = { film: 'Roja', year: 1992, directors: ['Mani Ratnam'], songs: [{ title: 'Kaadhal Rojaave', singers: ['SPB'] }] };
  const out = dedupe(flattenFilms([a, b]));
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].directors, ['Mani Ratnam']);
});
