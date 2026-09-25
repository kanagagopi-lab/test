import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../js/wikipedia.js';

const PAGES = {
  'Roja (soundtrack)': `{{Infobox album|name=Roja|type=soundtrack|artist=[[A. R. Rahman]]|released=1992}}
The soundtrack of ''[[Roja (film)|Roja]]''.
{{Track listing|extra_column=Singer(s)|all_lyrics=[[Vairamuthu]]
|title1=Chinna Chinna Aasai|extra1=[[Minmini]]}}`,
  'Roja (film)': `{{Infobox film|name=Roja|director=[[Mani Ratnam]]|starring={{ubl|[[Arvind Swamy]]|[[Madhoo]]}}|music=[[A. R. Rahman]]|released={{Film date|1992|08|15}}}}`,
};

function mockFetch(url) {
  const p = new URL(url).searchParams;
  let body;
  if (p.get('list') === 'categorymembers') {
    body = { query: { categorymembers: [{ ns: 0, title: 'Roja (soundtrack)' }, { ns: 14, title: 'Category:Sub' }] } };
  } else {
    const titles = p.get('titles').split('|');
    body = { query: { pages: titles.map((t) => (PAGES[t]
      ? { title: t, revisions: [{ slots: { main: { content: PAGES[t] } } }] }
      : { title: t, missing: true })) } };
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

test('category listing keeps articles only', async () => {
  const wiki = createClient({ fetchImpl: mockFetch });
  assert.deepEqual(await wiki.categoryMembers('Tamil film soundtracks'), ['Roja (soundtrack)']);
});

test('soundtrack import is enriched with the film article', async () => {
  const wiki = createClient({ fetchImpl: mockFetch });
  const [film] = await wiki.importTitles(['Roja (soundtrack)']);
  assert.equal(film.film, 'Roja');
  assert.equal(film.year, 1992);
  assert.deepEqual(film.directors, ['Mani Ratnam']);
  assert.deepEqual(film.actors, ['Arvind Swamy', 'Madhoo']);
  assert.equal(film.wiki, 'https://en.wikipedia.org/wiki/Roja_(film)');
  assert.deepEqual(film.songs[0].lyricists, ['Vairamuthu']);
  assert.deepEqual(film.songs[0].singers, ['Minmini']);
});

test('rate limiting (429) is retried, honouring Retry-After', async () => {
  let calls = 0;
  const flaky = (url) => {
    calls++;
    if (calls < 3) return Promise.resolve({ ok: false, status: 429, statusText: 'Too Many Requests', headers: new Headers({ 'retry-after': '0.01' }) });
    return mockFetch(url);
  };
  const wiki = createClient({ fetchImpl: flaky });
  assert.deepEqual(await wiki.categoryMembers('Tamil film soundtracks'), ['Roja (soundtrack)']);
  assert.equal(calls, 3);
  const always = () => Promise.resolve({ ok: false, status: 429, statusText: 'x', headers: new Headers({ 'retry-after': '0.001' }) });
  await assert.rejects(createClient({ fetchImpl: always, maxRetries: 2 }).categoryMembers('X'), /after 3 attempts/);
});
