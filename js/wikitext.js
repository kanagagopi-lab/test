// Minimal wikitext parsing for Tamil film / soundtrack articles on English Wikipedia.
// Handles {{Infobox film}}, {{Infobox album}}, {{Track listing}} and simple soundtrack
// wikitables. Pure functions: usable from the browser and from Node.

const OTHER_LANGS = /\b(hindi|telugu|malayalam|kannada|english|bengali|marathi)\b/i;

// Index just past the `}}` closing the template that opens at `start`, or -1.
function matchBraces(text, start) {
  let depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === '{' && text[i + 1] === '{') { depth++; i++; }
    else if (text[i] === '}' && text[i + 1] === '}') {
      depth--; i++;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

// Split on `sep` only where not nested inside {{ }} or [[ ]].
export function splitTopLevel(text, sep = '|') {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const two = text.slice(i, i + 2);
    if (two === '{{' || two === '[[') { depth++; cur += two; i++; continue; }
    if ((two === '}}' || two === ']]') && depth > 0) { depth--; cur += two; i++; continue; }
    if (depth === 0 && text.startsWith(sep, i)) { parts.push(cur); cur = ''; i += sep.length - 1; continue; }
    cur += text[i];
  }
  parts.push(cur);
  return parts;
}

// Find every template (at any nesting level) whose name matches `nameRe`.
export function findTemplates(text, nameRe) {
  const out = [];
  let i = text.indexOf('{{');
  while (i !== -1) {
    const end = matchBraces(text, i);
    if (end === -1) break;
    const inner = text.slice(i + 2, end - 2);
    const [rawName, ...rest] = splitTopLevel(inner);
    const name = rawName.replace(/<!--[\s\S]*?-->/g, '').trim().replace(/_/g, ' ');
    if (nameRe.test(name)) {
      const params = {};
      let pos = 1;
      for (const p of rest) {
        const eq = p.indexOf('=');
        const nested = p.search(/\{\{|\[\[/);
        if (eq !== -1 && (nested === -1 || eq < nested)) {
          params[p.slice(0, eq).trim().toLowerCase().replace(/[\s-]+/g, '_')] = p.slice(eq + 1).trim();
        } else {
          params[pos++] = p.trim();
        }
      }
      out.push({ name, params, start: i, end });
    }
    i = text.indexOf('{{', i + 2);
  }
  return out;
}

const LIST_TEMPLATES = /^(plain ?list|flat ?list|ubl|unbulleted ?list|hlist|bulleted ?list|ublist|endplainlist|startplainlist|collapsible list)$/i;
const KEEP_LAST = /^(nowrap|nobr|lang|transl|langx|small|big|nobold|noitalic|abbr|ill|interlanguage link)$/i;

function removeFileLinks(text) {
  let out = text;
  for (;;) {
    const m = out.match(/\[\[(?:File|Image):/i);
    if (!m) return out;
    let depth = 0;
    let i = m.index;
    for (; i < out.length - 1; i++) {
      if (out.startsWith('[[', i)) { depth++; i++; }
      else if (out.startsWith(']]', i)) { depth--; i++; if (depth === 0) break; }
    }
    out = out.slice(0, m.index) + out.slice(i + 1);
  }
}

// Turn a wikitext fragment into plain text; list items are separated by "\n".
export function clean(value) {
  let t = String(value ?? '');
  t = t.replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  t = removeFileLinks(t);
  t = t.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2').replace(/\[\[([^\]]*)\]\]/g, '$1');
  t = t.replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1').replace(/\[https?:\/\/\S+\]/g, '');
  // Resolve templates innermost-first.
  for (let guard = 0; guard < 50 && /\{\{/.test(t); guard++) {
    const next = t.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => {
      const [name, ...args] = inner.split('|').map((s) => s.trim());
      const positional = args.filter((a) => !/^[\w\s-]+=/.test(a));
      if (LIST_TEMPLATES.test(name)) return '\n' + positional.join('\n') + '\n';
      if (KEEP_LAST.test(name)) return positional[positional.length - 1] ?? '';
      return '';
    });
    if (next === t) break;
    t = next;
  }
  t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  t = t.replace(/'{2,}/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  return t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

// Split a cleaned credit field into individual names.
export function toList(value) {
  return clean(value)
    .split(/\n|\*|,|;|\s+and\s+|\s+&\s+|\s\/\s/)
    .map((s) => s.replace(/\([^)]*\)/g, '').replace(/^[\s:•·-]+|[\s:•·-]+$/g, '').trim())
    .filter((s) => s && s.length < 60 && !/^(various|n\/a|none|—|-)$/i.test(s));
}

export function yearOf(raw) {
  const m = String(raw ?? '').match(/\b(19[1-9]\d|20[0-4]\d)\b/);
  return m ? Number(m[1]) : null;
}

function cleanTitle(raw) {
  return clean(raw).replace(/\n/g, ' ').replace(/^["“”']+|["“”']+$/g, '').trim();
}

// Headings: [{ level, title, start }]
function headings(text) {
  const out = [];
  const re = /^(={2,6})\s*(.*?)\s*\1\s*$/gm;
  let m;
  while ((m = re.exec(text))) out.push({ level: m[1].length, title: clean(m[2]), start: m.index });
  return out;
}

function headingBefore(heads, pos) {
  let h = null;
  for (const x of heads) if (x.start < pos) h = x;
  return h;
}

// Text ranges of sections whose heading matches `re` (including their subsections).
function sectionRanges(text, heads, re) {
  const ranges = [];
  heads.forEach((h, idx) => {
    if (!re.test(h.title)) return;
    const next = heads.slice(idx + 1).find((x) => x.level <= h.level);
    ranges.push([h.start, next ? next.start : text.length]);
  });
  return ranges;
}

function isOtherLanguage(label) {
  return !!label && OTHER_LANGS.test(label) && !/tamil/i.test(label);
}

export function parseTrackListings(text) {
  const heads = headings(text);
  const songs = [];
  for (const t of findTemplates(text, /^(track ?listing|tracklist)$/i)) {
    const p = t.params;
    const h = headingBefore(heads, t.start);
    if (isOtherLanguage(clean(p.headline)) || isOtherLanguage(h?.title)) continue;
    const extraIsSinger = /sing|artist|vocal|perform/i.test(clean(p.extra_column ?? ''));
    for (let n = 1; n < 100; n++) {
      if (p[`title${n}`] == null) continue;
      const title = cleanTitle(p[`title${n}`]);
      if (!title) continue;
      songs.push({
        title,
        singers: extraIsSinger ? toList(p[`extra${n}`]) : [],
        lyricists: toList(p[`lyrics${n}`] ?? p[`writer${n}`] ?? p.all_lyrics ?? p.all_writing ?? ''),
        musicDirectors: toList(p[`music${n}`] ?? p.all_music ?? ''),
        length: clean(p[`length${n}`] ?? ''),
      });
    }
  }
  return songs;
}

function tableCells(line, sep) {
  return splitTopLevel(line.replace(/^[|!]/, ''), sep).map((cell) => {
    // Strip a leading attribute block: `style="…" | content`.
    const parts = splitTopLevel(cell, '|');
    return parts[parts.length - 1];
  });
}

export function parseSongTables(text) {
  const songs = [];
  const tables = text.match(/^\{\|[\s\S]*?^\|\}/gm) ?? [];
  for (const table of tables) {
    const rows = table.split(/^\|-.*$/m).slice(0);
    let cols = null;
    for (const row of rows) {
      const lines = row.split('\n').filter((l) => /^[|!]/.test(l) && !/^\{\||^\|\}|^\|\+/.test(l));
      if (!lines.length) continue;
      if (lines.every((l) => l.startsWith('!')) && !cols) {
        const names = lines.flatMap((l) => tableCells(l, '!!')).map((c) => clean(c).toLowerCase());
        const find = (re) => names.findIndex((n) => re.test(n));
        cols = {
          title: find(/song|title|track/),
          singers: find(/sing|artist|vocal/),
          lyricists: find(/lyric|writ/),
          musicDirectors: find(/music|compos/),
          length: find(/length|duration/),
        };
        if (cols.title === -1) cols = null;
        continue;
      }
      if (!cols) continue;
      const cells = lines.flatMap((l) => tableCells(l, l.startsWith('!') ? '!!' : '||'));
      const title = cleanTitle(cells[cols.title] ?? '');
      if (!title) continue;
      const get = (k) => (cols[k] >= 0 ? toList(cells[cols[k]] ?? '') : []);
      songs.push({
        title,
        singers: get('singers'),
        lyricists: get('lyricists'),
        musicDirectors: get('musicDirectors'),
        length: cols.length >= 0 ? clean(cells[cols.length] ?? '') : '',
      });
    }
  }
  return songs;
}

export function baseTitle(title) {
  return String(title).replace(/\s*\((?:\d{4} )?(?:tamil )?(?:film|soundtrack|album)\)\s*$/i, '').trim();
}

/**
 * Parse one article. Returns
 * { kind: 'film' | 'soundtrack' | 'other', film, year, directors, actors,
 *   musicDirectors, songs, filmLink, soundtrackLink }
 * filmLink: for a soundtrack article, the film it belongs to.
 * soundtrackLink: for a film article without a song list, its separate soundtrack article.
 */
export function parsePage(title, text) {
  const filmBox = findTemplates(text, /^infobox (tamil )?film$/i)[0]?.params;
  const albumBox = findTemplates(text, /^infobox album$/i)[0]?.params;
  const heads = headings(text);

  let songs = parseTrackListings(text);
  if (!songs.length) {
    const ranges = albumBox && !filmBox
      ? [[0, text.length]]
      : sectionRanges(text, heads, /soundtrack|music|songs|track ?list/i);
    for (const [a, b] of ranges) songs.push(...parseSongTables(text.slice(a, b)));
  }

  const kind = filmBox ? 'film' : albumBox ? 'soundtrack' : 'other';
  const box = filmBox ?? albumBox ?? {};
  const name = cleanTitle(box.name ?? '') || baseTitle(title);

  let filmLink = null;
  if (kind === 'soundtrack') {
    const lead = heads.length ? text.slice(0, heads[0].start) : text;
    const links = [...lead.replace(/\{\{[\s\S]*?\}\}/g, '').matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim());
    const base = baseTitle(title).toLowerCase();
    filmLink = links.find((l) => /\(.*film\)$/i.test(l) && baseTitle(l).toLowerCase() === base)
      ?? links.find((l) => /\(.*film\)$/i.test(l))
      ?? links.find((l) => l.toLowerCase() === base)
      ?? null;
  }

  let soundtrackLink = null;
  if (kind === 'film' && !songs.length) {
    const music = sectionRanges(text, heads, /soundtrack|music|songs/i).map(([a, b]) => text.slice(a, b)).join('\n');
    const main = findTemplates(music, /^(main|main article|further|see also)$/i)
      .flatMap((t) => Object.entries(t.params).filter(([k]) => /^\d+$/.test(k)).map(([, v]) => v.trim()));
    const linked = [...text.matchAll(/\[\[([^\]|#]+\((?:[^)]*\s)?soundtrack\))(?:\|[^\]]*)?\]\]/gi)].map((m) => m[1].trim());
    soundtrackLink = main.find((l) => /soundtrack|album/i.test(l)) ?? linked[0] ?? null;
  }

  // Films without a release date in the infobox usually say "is a 1995 Indian Tamil-language film".
  const lead = heads.length ? text.slice(0, heads[0].start) : text;
  const leadYear = yearOf(clean(lead.replace(/\{\{[\s\S]*?\}\}/g, '')).match(/\bis an? (?:\w+ )?(\d{4})\b/)?.[1]);

  return {
    kind,
    film: kind === 'soundtrack' ? baseTitle(title) : name,
    year: yearOf(box.released ?? box.release_date ?? box.release_dates ?? box.release ?? '') ?? leadYear,
    directors: filmBox ? toList(filmBox.director ?? '') : [],
    actors: filmBox ? toList(filmBox.starring ?? '') : [],
    musicDirectors: toList(filmBox?.music ?? albumBox?.artist ?? ''),
    language: clean(filmBox?.language ?? albumBox?.language ?? ''),
    songs,
    filmLink,
    soundtrackLink,
  };
}

// Film article titles linked from a "List of Tamil films of <year>" page. Film titles are
// italicised in those tables (''[[Roja (film)|Roja]]''), which separates them from the
// cast / crew links in the same rows.
export function filmLinksFromList(text) {
  const body = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  const out = new Set();
  for (const m of body.matchAll(/''\s*\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]\s*''/g)) {
    const t = m[1].trim().replace(/_/g, ' ');
    if (!t || t.includes(':') || /^list of/i.test(t)) continue;
    out.add(t[0].toUpperCase() + t.slice(1));
  }
  return [...out];
}

// Wikipedia's year-list page titles. Early decades are also covered by decade pages.
export function yearListTitles(from, to) {
  const titles = [];
  for (let y = from; y <= to; y++) titles.push(`List of Tamil films of ${y}`);
  for (let d = Math.floor(from / 10) * 10; d <= to; d += 10) {
    if (d < 1960) titles.push(`List of Tamil films of the ${d}s`);
  }
  return titles;
}
