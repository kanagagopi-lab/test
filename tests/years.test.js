import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '../js/wikipedia.js';
import { filmLinksFromList, yearListTitles, parsePage } from '../js/wikitext.js';
import { mockFetch, PAGES } from './fixtures/mock-wikipedia.js';

const wiki = createClient({ fetchImpl: mockFetch });

test('film links are read from year-list tables, skipping crew / files / other lists', () => {
  assert.deepEqual(filmLinksFromList(PAGES['List of Tamil films of 1987']), ['Nayakan', 'Velaikkaran (1987 film)']);
});

test('year list titles include decade pages for early years', () => {
  const t = yearListTitles(1938, 1941);
  assert.ok(t.includes('List of Tamil films of 1938'));
  assert.ok(t.includes('List of Tamil films of the 1930s'));
  assert.ok(t.includes('List of Tamil films of the 1940s'));
  assert.ok(!yearListTitles(1990, 1991).some((x) => x.includes('the 1990s')));
});

test('film page points to its soundtrack article; year falls back to the lead sentence', () => {
  assert.equal(parsePage('Nayakan', PAGES.Nayakan).soundtrackLink, 'Nayakan (soundtrack)');
  assert.equal(parsePage('Velaikkaran (1987 film)', PAGES['Velaikkaran (1987 film)']).year, 1987);
});

test('pages() merges continued responses and follows redirects', async () => {
  const got = await wiki.pages(['Nayagan', 'Velaikkaran (1987 film)', 'Missing page']);
  assert.equal(got.get('Nayagan').title, 'Nayakan');
  assert.ok(got.get('Velaikkaran (1987 film)').text.includes('Vaa Vaa'));
  assert.ok(!got.has('Missing page'));
});

test('year import finds films and their songs, including separate soundtrack articles', async () => {
  const titles = await wiki.yearListFilms(1987, 1987);
  const films = await wiki.importTitles(titles);
  const nayakan = films.find((f) => f.film === 'Nayakan');
  assert.equal(nayakan.year, 1987);
  assert.deepEqual(nayakan.directors, ['Mani Ratnam']);
  assert.deepEqual(nayakan.actors, ['Kamal Haasan', 'Saranya']);
  assert.deepEqual(nayakan.songs.map((s) => s.title), ['Thenpandi Seemayile', 'Nee Oru Kadhal Sangeetham']);
  assert.deepEqual(nayakan.songs[1].singers, ['Mano', 'K. S. Chithra']);
  assert.equal(nayakan.wiki, 'https://en.wikipedia.org/wiki/Nayakan');
  const vel = films.find((f) => f.film === 'Velaikkaran');
  assert.deepEqual(vel.songs[0].singers, ['S. P. Balasubrahmanyam']);
});

test('category depth follows subcategories without looping', async () => {
  assert.deepEqual(await wiki.categoryMembers('Tamil films'), ['Nayakan']);
  assert.deepEqual(await wiki.categoryMembers('Tamil films', { depth: 3 }), ['Nayakan', 'Velaikkaran (1987 film)']);
});

test('build script writes decade files and the manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tsf-'));
  copyFileSync(new URL('../data/seed.json', import.meta.url), join(dir, 'seed.json'));
  const run = () => execFileSync(process.execPath, [
    '--import', new URL('./fixtures/preload-mock.mjs', import.meta.url).pathname,
    new URL('../scripts/build-dataset.mjs', import.meta.url).pathname, '--years', '1987-1987',
  ], { env: { ...process.env, DATASET_DIR: dir }, stdio: ['ignore', 'ignore', 'pipe'] });
  run();
  const decade = JSON.parse(readFileSync(join(dir, 'wikipedia', '1980s.json'), 'utf8'));
  assert.equal(decade.films.length, 2);
  const manifest = JSON.parse(readFileSync(join(dir, 'datasets.json'), 'utf8'));
  assert.deepEqual(manifest.files, ['seed.json', 'wikipedia/1980s.json']);
  assert.equal(manifest.songs, JSON.parse(readFileSync(join(dir, 'seed.json'))).films.reduce((n, f) => n + f.songs.length, 0) + 3);
  // Second run resumes: the existing decade is skipped.
  run();
  assert.ok(existsSync(join(dir, 'wikipedia', '1980s.json')));
});
