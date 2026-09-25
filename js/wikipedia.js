// Fetch Tamil film / soundtrack articles from the English Wikipedia API and turn them into
// film records ({ film, year, directors, actors, musicDirectors, songs, wiki, source }).
// Works in the browser (CORS via origin=*) and in Node 18+ (pass a User-Agent header).

import { parsePage, baseTitle, filmLinksFromList, yearListTitles } from './wikitext.js';

export const API = 'https://en.wikipedia.org/w/api.php';
export const DEFAULT_CATEGORY = 'Category:Tamil film soundtracks';
export const FIRST_YEAR = 1931;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function wikiUrl(title) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

export function createClient({ fetchImpl = globalThis.fetch, headers = {}, api = API } = {}) {
  async function call(params) {
    const url = new URL(api);
    const all = { format: 'json', formatversion: '2', origin: '*', maxlag: '5', ...params };
    for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v);
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, { headers });
      const retryable = res.status === 429 || res.status >= 500;
      if (res.ok) {
        const data = await res.json();
        if (data.error?.code !== 'maxlag') {
          if (data.error) throw new Error(`Wikipedia API: ${data.error.info ?? data.error.code}`);
          return data;
        }
      } else if (!retryable) {
        throw new Error(`Wikipedia API ${res.status} ${res.statusText}`);
      }
      if (attempt >= 4) throw new Error(`Wikipedia API unavailable (${res.status})`);
      await sleep(1000 * 2 ** attempt);
    }
  }

  // Article titles in a category (namespace 0), descending `depth` levels of subcategories.
  async function categoryMembers(category, { limit = 5000, depth = 0, subcats, seen = new Set() } = {}) {
    if (subcats && !depth) depth = 1; // backwards-compatible boolean
    const cat = /^category:/i.test(category) ? category : `Category:${category}`;
    seen.add(cat);
    const titles = [];
    const subs = [];
    let cont;
    do {
      const data = await call({
        action: 'query', list: 'categorymembers', cmtitle: cat, cmlimit: 'max',
        cmtype: depth > 0 ? 'page|subcat' : 'page', ...(cont ? { cmcontinue: cont } : {}),
      });
      for (const m of data.query?.categorymembers ?? []) {
        if (m.ns === 0) titles.push(m.title);
        else if (m.ns === 14 && !seen.has(m.title)) subs.push(m.title);
      }
      cont = data.continue?.cmcontinue;
    } while (cont && titles.length < limit);
    for (const s of subs) {
      if (titles.length >= limit) break;
      titles.push(...(await categoryMembers(s, { limit: limit - titles.length, depth: depth - 1, seen })));
    }
    return [...new Set(titles)].slice(0, limit);
  }

  // Wikitext for many titles, 50 per request; redirects are followed. Large batches are
  // split by the API across several responses (`continue`), which are merged here.
  async function pages(titles) {
    const out = new Map();
    for (let i = 0; i < titles.length; i += 50) {
      const batch = titles.slice(i, i + 50);
      const alias = new Map();
      const byTitle = new Map();
      let cont = {};
      do {
        const data = await call({
          action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main',
          redirects: '1', titles: batch.join('|'), ...cont,
        });
        for (const r of [...(data.query?.normalized ?? []), ...(data.query?.redirects ?? [])]) alias.set(r.from, r.to);
        for (const p of data.query?.pages ?? []) {
          const text = p.revisions?.[0]?.slots?.main?.content;
          if (text) byTitle.set(p.title, text);
        }
        cont = data.continue ?? null;
      } while (cont);
      const resolve = (t) => {
        for (let n = 0; alias.has(t) && n < 5; n++) t = alias.get(t);
        return t;
      };
      for (const t of batch) {
        const title = resolve(t);
        if (byTitle.has(title)) out.set(t, { title, text: byTitle.get(title) });
      }
    }
    return out;
  }

  // Film article titles listed on "List of Tamil films of <year>" pages.
  async function yearListFilms(from, to, onProgress = () => {}) {
    const lists = await pages(yearListTitles(from, to));
    const films = new Set();
    for (const { title, text } of lists.values()) {
      const found = filmLinksFromList(text);
      found.forEach((f) => films.add(f));
      onProgress({ message: `${title}: ${found.length} films` });
    }
    return [...films];
  }

  /**
   * Import articles (soundtrack or film pages) as film records.
   * onProgress({ done, total, message }) is called as work proceeds.
   */
  async function importTitles(titles, onProgress = () => {}) {
    const total = titles.length;
    onProgress({ done: 0, total, message: `Fetching ${total} article(s)…` });
    const fetched = await pages(titles);
    const parsed = [...fetched.values()].map(({ title, text }) => ({ title, info: parsePage(title, text) }));

    // Soundtrack articles lack cast/director: pull those from the linked film article.
    // Film articles without a song list often point to a separate soundtrack article.
    const filmOf = (p) => p.info.filmLink ?? `${baseTitle(p.title)} (film)`;
    const extra = new Set();
    for (const p of parsed) {
      if (p.info.kind === 'soundtrack') extra.add(filmOf(p));
      if (p.info.kind === 'film' && p.info.soundtrackLink) extra.add(p.info.soundtrackLink);
    }
    const already = new Set(parsed.map((p) => p.title));
    const extraPages = await pages([...extra].filter((t) => !already.has(t)));
    const info = new Map(parsed.map((p) => [p.title, p]));
    for (const [t, { title, text }] of extraPages) {
      const p = { title, info: parsePage(title, text) };
      info.set(t, p);
      info.set(title, p);
    }

    const films = new Map();
    for (const { title, info: page } of parsed) {
      let film = page;
      let wikiTitle = title;
      let songs = page.songs;
      if (page.kind === 'soundtrack') {
        const f = info.get(filmOf({ title, info: page }));
        if (f?.info.kind === 'film') {
          film = { ...f.info, year: f.info.year ?? page.year };
          if (!film.musicDirectors.length) film.musicDirectors = page.musicDirectors;
          if (!songs.length) songs = f.info.songs;
          wikiTitle = f.title;
        }
      } else if (page.kind === 'film' && !songs.length && page.soundtrackLink) {
        const st = info.get(page.soundtrackLink);
        if (st) songs = st.info.songs;
      } else if (page.kind === 'other') {
        continue;
      }
      if (!songs.length) continue;
      const key = wikiUrl(wikiTitle);
      if (films.has(key) && films.get(key).songs.length >= songs.length) continue;
      films.set(key, {
        film: film.film,
        year: film.year,
        directors: film.directors,
        actors: film.actors,
        musicDirectors: film.musicDirectors,
        songs,
        wiki: key,
        source: 'Wikipedia',
      });
    }
    const list = [...films.values()];
    onProgress({
      done: total, total,
      message: `Imported ${list.length} film(s), ${list.reduce((n, f) => n + f.songs.length, 0)} song(s) from ${fetched.size} article(s)`,
    });
    return list;
  }

  return { call, categoryMembers, pages, yearListFilms, importTitles };
}
