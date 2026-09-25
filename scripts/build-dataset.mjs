#!/usr/bin/env node
// Build data/wikipedia.json from Wikipedia so the app ships with a large song list.
// The app loads this file automatically if it exists.
//
//   node scripts/build-dataset.mjs [--category "Category:Tamil film soundtracks"] [--limit 5000] [--subcats]
//                                  [--titles "Roja (soundtrack),Nayakan"] [--out data/wikipedia.json]

import { writeFile } from 'node:fs/promises';
import { createClient, DEFAULT_CATEGORY } from '../js/wikipedia.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const category = opt('category', DEFAULT_CATEGORY);
const limit = Number(opt('limit', 5000));
const out = opt('out', 'data/wikipedia.json');
const titlesArg = opt('titles', '');

const wiki = createClient({
  headers: { 'User-Agent': 'TamilSongFinder/1.0 (dataset builder; https://github.com/kanagagopi-lab/test)' },
});

const titles = titlesArg
  ? titlesArg.split(',').map((s) => s.trim()).filter(Boolean)
  : await wiki.categoryMembers(category, { limit, subcats: args.includes('--subcats') });
console.error(`${titles.length} article(s) to fetch`);

const films = [];
for (let i = 0; i < titles.length; i += 100) {
  films.push(...(await wiki.importTitles(titles.slice(i, i + 100), ({ message }) => console.error(message))));
}

films.sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.film.localeCompare(b.film));
await writeFile(out, JSON.stringify({
  source: `Wikipedia (${titlesArg ? 'selected articles' : category}), built ${new Date().toISOString().slice(0, 10)}. Text under CC BY-SA 4.0.`,
  films,
}, null, 1));
console.error(`Wrote ${films.length} films / ${films.reduce((n, f) => n + f.songs.length, 0)} songs to ${out}`);
