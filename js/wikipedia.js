// Fetch Tamil film / soundtrack articles from the English Wikipedia API and turn them into
// film records ({ film, year, directors, actors, musicDirectors, songs, wiki, source }).
// Works in the browser (CORS via origin=*) and in Node 18+ (pass a User-Agent header).

import { parsePage as parseWikitext, baseTitle, filmLinksFromList, yearListTitles, LINK_MARK, personName } from './wikitext.js';

// Keep credit link targets so they can be resolved through redirects below.
const parsePage = (title, text) => parseWikitext(title, text, { rawLinks: true });

export const API = 'https://en.wikipedia.org/w/api.php';
export const DEFAULT_CATEGORY = 'Category:Tamil film soundtracks';
export const FIRST_YEAR = 1931;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function wikiUrl(title) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

// minInterval: minimum ms between requests (be polite in bulk builds).
// maxRetries / maxWait: how long to keep trying when Wikipedia is busy or rate-limits us.
export function createClient({
  fetchImpl = globalThis.fetch, headers = {}, api = API, minInterval = 0, maxRetries = 8, maxWait = 60000,
} = {}) {
  let last = 0;
  async function call(params) {
    const url = new URL(api);
    const all = { format: 'json', formatversion: '2', origin: '*', maxlag: '5', ...params };
    for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v);
    for (let attempt = 0; ; attempt++) {
      const gap = last + minInterval - Date.now();
      if (gap > 0) await sleep(gap);
      last = Date.now();
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
      if (attempt >= maxRetries) throw new Error(`Wikipedia API unavailable (${res.status}) after ${attempt + 1} attempts`);
      // Honour Retry-After (seconds) when given; otherwise back off exponentially.
      const retryAfter = Number(res.headers?.get?.('retry-after')) * 1000;
      await sleep(Math.min(maxWait, retryAfter > 0 ? retryAfter : 1000 * 2 ** attempt));
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
        else if (m.ns === 14 && depth > 0 && !seen.has(m.title)) subs.push(m.title);
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

  // Final article title for each title, following normalisation and redirects
  // ("Vijay (actor)" and "C. Joseph Vijay" end up at the same article).
  async function resolveTitles(titles) {
    const out = new Map();
    const list = [...new Set(titles)];
    for (let i = 0; i < list.length; i += 50) {
      const batch = list.slice(i, i + 50);
      const data = await call({ action: 'query', redirects: '1', titles: batch.join('|') });
      const alias = new Map();
      for (const r of [...(data.query?.normalized ?? []), ...(data.query?.redirects ?? [])]) alias.set(r.from, r.to);
      for (const t of batch) {
        let r = t;
        for (let n = 0; alias.has(r) && n < 5; n++) r = alias.get(r);
        out.set(t, r);
      }
    }
    return out;
  }

  // Replace link markers in credits with the resolved article's name.
  async function finalizeNames(films) {
    const PEOPLE = ['directors', 'actors', 'musicDirectors', 'lyricists', 'singers'];
    const targets = new Set();
    const each = (fn) => {
      for (const f of films) {
        for (const k of PEOPLE) if (f[k]) f[k] = fn(f[k]);
        for (const s of f.songs) for (const k of PEOPLE) if (s[k]) s[k] = fn(s[k]);
      }
    };
    each((list) => { list.forEach((v) => v.startsWith(LINK_MARK) && targets.add(v.slice(1))); return list; });
    let resolved = new Map();
    try {
      resolved = await resolveTitles([...targets]);
    } catch { /* fall back to the link targets as written */ }
    each((list) => [...new Set(list.map((v) => (v.startsWith(LINK_MARK) ? personName(resolved.get(v.slice(1)) ?? v.slice(1)) : v)))]);
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
    await finalizeNames(list);
    onProgress({
      done: total, total,
      message: `Imported ${list.length} film(s), ${list.reduce((n, f) => n + f.songs.length, 0)} song(s) from ${fetched.size} article(s)`,
    });
    return list;
  }

  return { call, categoryMembers, pages, resolveTitles, yearListFilms, importTitles };
}
