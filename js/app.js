import { FIELDS, flattenFilms, dedupe, index, search, isEmptyQuery, facet, distinct } from './search.js';
import { loadLibrary, saveLibrary, mergeFilms, clearLibrary } from './store.js';
import { createClient, DEFAULT_CATEGORY } from './wikipedia.js';

const PAGE = 50;
const FACET_KEYS = ['musicDirectors', 'lyricists', 'singers', 'actors', 'directors', 'film'];
const LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));

const $ = (sel) => document.querySelector(sel);
const form = $('#search');
const wiki = createClient();

let seedFilms = [];
let libraryFilms = loadLibrary();
let songs = [];
let indexed = [];
let shown = PAGE;

// ---------- data ----------

async function loadJson(url) {
  try {
    const res = await fetch(url);
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

function rebuild() {
  songs = dedupe([
    ...flattenFilms(libraryFilms, 'Wikipedia'),
    ...flattenFilms(seedFilms, 'Starter set'),
  ]);
  indexed = index(songs);
  const films = new Set(songs.map((s) => `${s.film}|${s.year}`)).size;
  $('#lib-stats').textContent = `${songs.length.toLocaleString()} songs from ${films.toLocaleString()} films` +
    (libraryFilms.length ? ` (${libraryFilms.length.toLocaleString()} films imported)` : '');
  for (const f of FIELDS) {
    const dl = document.getElementById(`dl-${f.key}`);
    dl.replaceChildren(...distinct(songs, f.key).slice(0, 3000).map((v) => new Option(v)));
  }
  render();
}

// ---------- form & URL state ----------

function buildFields() {
  const grid = $('#fields');
  for (const f of FIELDS) {
    const label = document.createElement('label');
    label.className = 'field';
    label.innerHTML = `<span>${f.label}</span>
      <input type="search" name="${f.key}" list="dl-${f.key}" placeholder="${f.placeholder}">
      <datalist id="dl-${f.key}"></datalist>`;
    grid.append(label);
  }
}

function readQuery() {
  return Object.fromEntries(new FormData(form).entries());
}

function writeUrl(q) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (String(v).trim()) params.set(k, v);
  const s = $('#sort').value;
  if (s !== 'year-desc') params.set('sort', s);
  const qs = params.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

function readUrl() {
  const params = new URLSearchParams(location.search);
  for (const [k, v] of params) {
    if (k === 'sort') $('#sort').value = v;
    else if (form.elements[k]) form.elements[k].value = v;
  }
}

function addFilter(key, value) {
  const input = form.elements[key];
  const current = input.value.split(',').map((s) => s.trim()).filter(Boolean);
  if (!current.includes(value)) input.value = [...current, value].join(', ');
  shown = PAGE;
  render();
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- rendering ----------

function sortSongs(list) {
  const by = $('#sort').value;
  const cmp = {
    'year-desc': (a, b) => (b.year ?? 0) - (a.year ?? 0) || a.film.localeCompare(b.film),
    'year-asc': (a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.film.localeCompare(b.film),
    title: (a, b) => a.title.localeCompare(b.title),
    film: (a, b) => a.film.localeCompare(b.film) || a.title.localeCompare(b.title),
  }[by];
  return [...list].sort(cmp);
}

function chip(key, value) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = value;
  b.title = `Add “${value}” to ${LABEL[key]}`;
  b.addEventListener('click', () => addFilter(key, value));
  return b;
}

function link(href, text) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

function songItem(s) {
  const li = $('#song-tpl').content.firstElementChild.cloneNode(true);
  li.querySelector('.title').textContent = s.title;
  const film = li.querySelector('.film');
  film.append(chip('film', s.film));
  if (s.year) film.append(` (${s.year})`);
  if (s.length) film.append(` · ${s.length}`);

  const dl = li.querySelector('.credits');
  for (const key of ['musicDirectors', 'lyricists', 'singers', 'actors', 'directors']) {
    if (!s[key].length) continue;
    const dt = document.createElement('dt');
    dt.textContent = LABEL[key];
    const dd = document.createElement('dd');
    dd.append(...s[key].map((v) => chip(key, v)));
    dl.append(dt, dd);
  }

  const q = `${s.title} ${s.film}`;
  const links = li.querySelector('.links');
  links.append(
    link(`https://www.youtube.com/results?search_query=${encodeURIComponent(`${q} song`)}`, 'YouTube'),
    link(`https://gaana.com/search/${encodeURIComponent(q)}`, 'Gaana'),
  );
  if (s.wiki) links.append(link(s.wiki, 'Wikipedia'));
  return li;
}

function renderFacets(results) {
  const box = $('#facets');
  box.replaceChildren();
  const h = document.createElement('h2');
  h.textContent = 'Refine';
  box.append(h);
  if (!results.length) return;
  for (const key of FACET_KEYS) {
    const top = facet(results, key, 6);
    if (top.length < 2 && key !== 'film') continue;
    const sec = document.createElement('section');
    const h3 = document.createElement('h3');
    h3.textContent = key === 'film' ? 'Movie' : LABEL[key];
    const ul = document.createElement('ul');
    for (const [v, n] of top) {
      const li = document.createElement('li');
      const c = chip(key, v);
      const count = document.createElement('span');
      count.className = 'n';
      count.textContent = n;
      li.append(c, count);
      ul.append(li);
    }
    sec.append(h3, ul);
    box.append(sec);
  }
}

function render() {
  const q = readQuery();
  writeUrl(q);
  const results = sortSongs(isEmptyQuery(q) ? songs : search(indexed, q));
  $('#count').textContent = isEmptyQuery(q)
    ? `All songs (${results.length.toLocaleString()})`
    : `${results.length.toLocaleString()} matching song${results.length === 1 ? '' : 's'}`;
  const list = $('#list');
  list.replaceChildren(...results.slice(0, shown).map(songItem));
  if (!results.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No songs match. Try fewer fields or a different spelling, or import more films from Wikipedia in the Library below.';
    list.append(li);
  }
  $('#more').hidden = results.length <= shown;
  renderFacets(results);
}

// ---------- library / import ----------

function log(msg) {
  const el = $('#log');
  el.textContent += `${msg}\n`;
  el.scrollTop = el.scrollHeight;
}

function setBusy(busy) {
  for (const id of ['#import-cat', '#import-titles', '#clear', '#export']) $(id).disabled = busy;
  $('#progress').hidden = !busy;
}

function onProgress({ done, total, message }) {
  const p = $('#progress');
  p.max = total || 1;
  p.value = done;
  log(message);
}

async function runImport(getTitles) {
  setBusy(true);
  try {
    const titles = await getTitles();
    if (!titles.length) { log('Nothing to import.'); return; }
    const CHUNK = 100;
    let imported = 0;
    for (let i = 0; i < titles.length; i += CHUNK) {
      const films = await wiki.importTitles(titles.slice(i, i + CHUNK), onProgress);
      libraryFilms = mergeFilms(libraryFilms, films);
      imported += films.length;
      if (!saveLibrary(libraryFilms)) log('Warning: browser storage is full or unavailable. Songs will be lost on reload.');
      rebuild();
    }
    log(`Done. ${imported} film(s) added or updated.`);
  } catch (err) {
    log(`Import failed: ${err.message}`);
  } finally {
    setBusy(false);
  }
}

function wireLibrary() {
  $('#import-cat').addEventListener('click', () => runImport(async () => {
    const cat = $('#cat').value.trim() || DEFAULT_CATEGORY;
    const limit = Number($('#cat-limit').value) || 300;
    log(`Listing ${cat}…`);
    const titles = await wiki.categoryMembers(cat, { limit, subcats: $('#cat-subcats').checked });
    log(`Found ${titles.length} article(s).`);
    return titles;
  }));

  $('#import-titles').addEventListener('click', () => runImport(async () =>
    $('#titles').value.split('\n').map((s) => s.trim()).filter(Boolean)));

  $('#export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ source: 'Tamil Song Finder export', films: libraryFilms }, null, 1)], { type: 'application/json' });
    const a = link(URL.createObjectURL(blob), '');
    a.download = 'tamil-songs-library.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const films = Array.isArray(data) ? data : data.films;
      if (!Array.isArray(films)) throw new Error('expected { "films": [...] }');
      libraryFilms = mergeFilms(libraryFilms, films);
      saveLibrary(libraryFilms);
      log(`Loaded ${films.length} film(s) from ${file.name}.`);
      rebuild();
    } catch (err) {
      log(`Could not load ${file.name}: ${err.message}`);
    }
    e.target.value = '';
  });

  $('#clear').addEventListener('click', () => {
    if (!confirm('Remove all imported songs from this browser? The starter set stays.')) return;
    libraryFilms = [];
    clearLibrary();
    log('Imported songs removed.');
    rebuild();
  });
}

// ---------- boot ----------

async function main() {
  buildFields();
  readUrl();
  let timer;
  form.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { shown = PAGE; render(); }, 120);
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('reset', () => setTimeout(() => { shown = PAGE; render(); }));
  $('#sort').addEventListener('change', render);
  $('#more').addEventListener('click', () => { shown += PAGE; render(); });
  wireLibrary();

  const [seed, bundled] = await Promise.all([loadJson('data/seed.json'), loadJson('data/wikipedia.json')]);
  seedFilms = [...(seed?.films ?? []), ...(bundled?.films ?? [])];
  rebuild();
}

main();
