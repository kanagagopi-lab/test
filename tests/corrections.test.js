import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCorrections, validateCorrection } from '../js/corrections.js';
import { flattenFilms } from '../js/search.js';

const films = () => [{
  film: 'Naalu Veli Nilam', year: 1959, directors: ['Muktha V. Srinivasan'], actors: [],
  musicDirectors: ['00:49'],
  songs: [
    { title: 'Ooraar Urangaiyile', singers: ['L. R. Eswari'], musicDirectors: ['K. V. Mahadevan'] },
    { title: 'Kaani Nilam Vendum', singers: ['Soolamangalam Rajalakshmi'], musicDirectors: ['00:49'] },
  ],
}];

test('film-level fix replaces the film credit and stale per-song values', () => {
  const out = applyCorrections(films(), [
    { film: 'Naalu Veli Nilam', year: 1959, set: { musicDirectors: ['K. V. Mahadevan', 'M. K. Athmanathan'] } },
  ]);
  const songs = flattenFilms(out);
  assert.deepEqual(songs[1].musicDirectors, ['K. V. Mahadevan', 'M. K. Athmanathan']);
  assert.deepEqual(songs[0].musicDirectors, ['K. V. Mahadevan', 'M. K. Athmanathan']);
});

test('song-level fix wins over a film-level one, whatever the order', () => {
  const out = applyCorrections(films(), [
    { film: 'naalu veli nilam', song: 'Kaani Nilam Vendum', set: { musicDirectors: ['M. K. Athmanathan'] } },
    { film: 'Naalu Veli Nilam', set: { musicDirectors: ['K. V. Mahadevan', 'M. K. Athmanathan'] } },
  ]);
  const songs = flattenFilms(out);
  assert.deepEqual(songs[1].musicDirectors, ['M. K. Athmanathan']);
  assert.deepEqual(songs[0].musicDirectors, ['K. V. Mahadevan', 'M. K. Athmanathan']);
});

test('songs and films can be renamed, added and deleted', () => {
  const out = applyCorrections(films(), [
    { film: 'Naalu Veli Nilam', song: 'Ooraar Urangaiyile', set: { title: 'Oorar Urangaiyile' } },
    { film: 'Naalu Veli Nilam', song: 'Kaani Nilam Vendum', delete: true },
    { film: 'Naalu Veli Nilam', song: 'New Song', set: { singers: ['P. Susheela'] } },
    { film: 'Brand New Film', year: 1960, song: 'Pattu', set: { singers: ['T. M. Soundararajan'] } },
  ]);
  const songs = flattenFilms(out).map((s) => `${s.film}: ${s.title}`);
  assert.deepEqual(songs, ['Naalu Veli Nilam: Oorar Urangaiyile', 'Naalu Veli Nilam: New Song', 'Brand New Film: Pattu']);
  assert.equal(applyCorrections(films(), [{ film: 'Naalu Veli Nilam', delete: true }]).length, 0);
});

test('year narrows the match; inputs are not mutated', () => {
  const input = films();
  const out = applyCorrections(input, [{ film: 'Naalu Veli Nilam', year: 1990, set: { year: 1991 } }]);
  assert.equal(out.length, 2); // no 1990 film, so a new one is created
  assert.deepEqual(input[0].musicDirectors, ['00:49']);
});

test('invalid corrections are rejected with a clear message and skipped when applying', () => {
  assert.throws(() => validateCorrection({ set: {} }), /film/);
  assert.throws(() => validateCorrection({ film: 'X', set: { singers: 'SPB' } }), /can't be set on a film/);
  assert.throws(() => validateCorrection({ film: 'X', song: 'Y', set: { singers: 'SPB' } }), /list of names/);
  assert.throws(() => validateCorrection({ film: 'X', set: { year: 'soon' } }), /year/);
  assert.throws(() => validateCorrection({ film: 'X', set: { hacked: true } }), /can't be set/);
  assert.equal(applyCorrections(films(), [{ film: 'Naalu Veli Nilam', set: { bogus: 1 } }])[0].musicDirectors[0], '00:49');
});
