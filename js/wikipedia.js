// Fetch Tamil film / soundtrack articles from the English Wikipedia API and turn them into
// film records ({ film, year, directors, actors, musicDirectors, songs, wiki, source }).
// Works in the browser (CORS via origin=*) and in Node 18+ (pass a User-Agent header).

import { parsePage, baseTitle } from './wikitext.js';

export const API = 'https://en.wikipedia.org/w/api.php';
export const DEFAULT_CATEGORY = 'Category:Tamil film soundtracks';

export function createClient({ fetchImpl = globalThis.fetch, headers = {}, api = API } = {}) {
  async function call(params) {
    const url = new URL(api);
    for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', origin: '*', ...params })) {
      url.searchParams.set(k, v);
    }
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, { headers });
      if (res.ok) return res.json();
      if (attempt >= 3 || (res.status !== 429 && res.status < 500)) {
        throw new Error(`Wikipedia API ${res.status} ${res.statusText}`);
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }

  // Article titles in a category (namespace 0), optionally one level of subcategories.
  async function categoryMembers(category, { limit = 5000, subcats = false } = {}) {
    const cat = /^category:/i.test(category) ? category : `Category:${category}`;
    const titles = [];
    const subs = [];
    let cont;
    do {
      const data = await call({
        action: 'query', list: 'categorymembers', cmtitle: cat, cmlimit: 'max',
        cmtype: subcats ? 'page|subcat' : 'page', ...(cont ? { cmcontinue: cont } : {}),
      });
      for (const m of data.query?.categorymembers ?? []) {
        if (m.ns === 0) titles.push(m.title);
        else if (m.ns === 14) subs.push(m.title);
      }
      cont = data.continue?.cmcontinue;
    } while (cont && titles.length < limit);
    for (const s of subs) {
      if (titles.length >= limit) break;
      titles.push(...(await categoryMembers(s, { limit: limit - titles.length })));
    }
    return [...new Set(titles)].slice(0, limit);
  }

  // Wikitext for many titles, 50 per request; redirects are followed.
  async function pages(titles) {
    const out = new Map();
    for (let i = 0; i < titles.length; i += 50) {
      const batch = titles.slice(i, i + 50);
      const data = await call({
        action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main',
        redirects: '1', titles: batch.join('|'),
      });
      const alias = new Map();
      for (const r of [...(data.query?.normalized ?? []), ...(data.query?.redirects ?? [])]) alias.set(r.from, r.to);
      const resolve = (t) => { while (alias.has(t)) t = alias.get(t); return t; };
      const byTitle = new Map((data.query?.pages ?? []).map((p) => [p.title, p]));
      for (const t of batch) {
        const p = byTitle.get(resolve(t));
        const text = p?.revisions?.[0]?.slots?.main?.content;
        if (text) out.set(t, { title: p.title, text });
      }
    }
    return out;
  }

  /**
   * Import articles (soundtrack or film pages) as film records.
   * onProgress({ done, total, message }) is called as work proceeds.
   */
  async function importTitles(titles, onProgress = () => {}) {
    const total = titles.length;
    onProgress({ done: 0, total, message: `Fetching ${total} article(s)…` });
    const fetched = await pages(titles);
    const parsed = [];
    for (const { title, text } of fetched.values()) parsed.push({ title, info: parsePage(title, text) });
    onProgress({ done: Math.round(total / 2), total, message: `Parsed ${parsed.length} article(s)` });

    // Soundtrack articles lack cast/director; pull those from the linked film article.
    const filmTitles = [...new Set(parsed
      .filter((p) => p.info.kind === 'soundtrack')
      .map((p) => p.info.filmLink ?? `${baseTitle(p.title)} (film)`))];
    const filmPages = filmTitles.length ? await pages(filmTitles) : new Map();
    const filmInfo = new Map();
    for (const [t, { title, text }] of filmPages) filmInfo.set(t, { title, info: parsePage(title, text) });

    const films = [];
    for (const { title, info } of parsed) {
      let record = info;
      let wikiTitle = title;
      if (info.kind === 'soundtrack') {
        const f = filmInfo.get(info.filmLink ?? `${baseTitle(title)} (film)`);
        if (f && f.info.kind === 'film') {
          record = {
            ...f.info,
            year: f.info.year ?? info.year,
            musicDirectors: f.info.musicDirectors.length ? f.info.musicDirectors : info.musicDirectors,
            songs: info.songs.length ? info.songs : f.info.songs,
          };
          wikiTitle = f.title;
        }
      }
      if (!record.songs.length) continue;
      films.push({
        film: record.film,
        year: record.year,
        directors: record.directors,
        actors: record.actors,
        musicDirectors: record.musicDirectors,
        songs: record.songs,
        wiki: `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle.replace(/ /g, '_'))}`,
        source: 'Wikipedia',
      });
    }
    onProgress({ done: total, total, message: `Imported ${films.length} film(s), ${films.reduce((n, f) => n + f.songs.length, 0)} song(s)` });
    return films;
  }

  return { call, categoryMembers, pages, importTitles };
}
