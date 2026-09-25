#!/usr/bin/env node
// Build bundled song datasets from Wikipedia. The app loads every file listed in
// data/datasets.json, which this script regenerates.
//
// By year (recommended — covers almost every Tamil film; one file per decade):
//   node scripts/build-dataset.mjs                     # all years, 1931 → this year
//   node scripts/build-dataset.mjs --years 1931-2025
//   node scripts/build-dataset.mjs --years 1990-1999 --force     # rebuild that decade
//
// By category or explicit titles (one output file):
//   node scripts/build-dataset.mjs --category "Category:Tamil film soundtracks" [--depth 1] [--limit 5000]
//   node scripts/build-dataset.mjs --titles "Nayakan,Anniyan (soundtrack)" --out data/wikipedia/extra.json
//
// Decade files that already exist are skipped unless --force is given, so an interrupted
// run can simply be restarted.

import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, FIRST_YEAR } from '../js/wikipedia.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATASET_DIR ?? join(ROOT, 'data'); // override used by tests
const OUT_DIR = join(DATA, 'wikipedia');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);
const log = (...m) => console.error(...m);

const wiki = createClient({
  headers: { 'User-Agent': 'TamilSongFinder/1.0 (dataset builder; https://github.com/kanagagopi-lab/test)' },
});

const exists = (p) => access(p).then(() => true, () => false);

async function importAll(titles) {
  const films = [];
  for (let i = 0; i < titles.length; i += 100) {
    films.push(...(await wiki.importTitles(titles.slice(i, i + 100), ({ message }) => log(`  ${message}`))));
    log(`  ${Math.min(i + 100, titles.length)} / ${titles.length} articles`);
  }
  const byKey = new Map(films.map((f) => [f.wiki, f]));
  return [...byKey.values()].sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.film.localeCompare(b.film));
}

async function write(path, films, description) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({
    source: `${description}. From English Wikipedia, built ${new Date().toISOString().slice(0, 10)}. Text under CC BY-SA 4.0.`,
    films,
  }, null, 1) + '\n');
  log(`Wrote ${films.length} films / ${films.reduce((n, f) => n + f.songs.length, 0)} songs to ${relative(ROOT, path)}`);
}

// data/datasets.json = seed.json + every data/wikipedia/*.json
async function writeManifest() {
  const files = ['seed.json'];
  if (await exists(OUT_DIR)) {
    for (const f of (await readdir(OUT_DIR)).filter((f) => f.endsWith('.json')).sort()) files.push(`wikipedia/${f}`);
  }
  let songs = 0;
  let films = 0;
  for (const f of files) {
    const d = JSON.parse(await readFile(join(DATA, f), 'utf8'));
    films += d.films.length;
    songs += d.films.reduce((n, x) => n + x.songs.length, 0);
  }
  await writeFile(join(DATA, 'datasets.json'), JSON.stringify({ files, films, songs }, null, 1) + '\n');
  log(`data/datasets.json: ${files.length} file(s), ${films} films, ${songs} songs`);
}

async function byYears(spec) {
  const [a, b] = spec.split('-').map(Number);
  const from = Math.max(FIRST_YEAR, a);
  const to = b || a;
  for (let decade = Math.floor(from / 10) * 10; decade <= to; decade += 10) {
    const out = join(OUT_DIR, `${decade}s.json`);
    if (!flag('force') && await exists(out)) {
      log(`${decade}s: ${relative(ROOT, out)} exists, skipping (use --force to rebuild)`);
      continue;
    }
    const y0 = Math.max(from, decade);
    const y1 = Math.min(to, decade + 9);
    log(`${decade}s: reading film lists ${y0}–${y1}`);
    const titles = await wiki.yearListFilms(y0, y1, ({ message }) => log(`  ${message}`));
    log(`${decade}s: ${titles.length} film articles`);
    const films = await importAll(titles);
    await write(out, films, `Tamil films of ${y0}–${y1} (List of Tamil films of <year> pages)`);
  }
}

if (opt('titles', null) || opt('category', null)) {
  const titlesArg = opt('titles', '');
  const category = opt('category', '');
  const titles = titlesArg
    ? titlesArg.split(',').map((s) => s.trim()).filter(Boolean)
    : await wiki.categoryMembers(category, { limit: Number(opt('limit', 50000)), depth: Number(opt('depth', 0)) });
  log(`${titles.length} article(s) to fetch`);
  const slug = (category || 'titles').replace(/^category:/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const out = opt('out', null) ? join(ROOT, opt('out')) : join(OUT_DIR, `category-${slug}.json`);
  await write(out, await importAll(titles), titlesArg ? 'Selected articles' : category);
} else {
  await byYears(opt('years', `${FIRST_YEAR}-${new Date().getFullYear()}`));
}
await writeManifest();
