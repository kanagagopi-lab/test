// A tiny fake of the Wikipedia API covering year lists, film pages, soundtrack pages,
// redirects, `continue` splitting and categories. Used by the tests.

export const PAGES = {
  'List of Tamil films of 1987': `== Films ==
{| class="wikitable"
! Title !! Director !! Cast
|-
| ''[[Nayakan]]'' || [[Mani Ratnam]] || [[Kamal Haasan]]
|-
| ''[[Velaikkaran (1987 film)|Velaikkaran]]'' || [[S. P. Muthuraman]] || [[Rajinikanth]]
|-
| ''[[File:x.jpg]]'' || ''[[List of Tamil films of 1986]]'' ||
|}`,
  Nayakan: `{{Infobox film|name=Nayakan|director=[[Mani Ratnam]]|starring={{ubl|[[Kamal Haasan]]|[[Saranya Ponvannan|Saranya]]}}|music=[[Ilaiyaraaja]]|released={{Film date|1987|10|21}}}}
== Soundtrack ==
{{Main|Nayakan (soundtrack)}}
The soundtrack was composed by Ilaiyaraaja.`,
  'Nayakan (soundtrack)': `{{Infobox album|name=Nayakan|type=soundtrack|artist=[[Ilaiyaraaja]]}}
Soundtrack of ''[[Nayakan]]''.
{{Track listing|extra_column=Singer(s)
|title1=Thenpandi Seemayile|extra1=[[Ilaiyaraaja]]|lyrics1=[[Pulamaipithan]]
|title2=Nee Oru Kadhal Sangeetham|extra2=[[Mano (singer)|Mano]], [[K. S. Chithra]]|lyrics2=[[Pulamaipithan]]}}`,
  'Velaikkaran (1987 film)': `'''Velaikkaran''' is a 1987 Indian Tamil-language film directed by [[S. P. Muthuraman]].
{{Infobox film|name=Velaikkaran|director=[[S. P. Muthuraman]]|starring=[[Rajinikanth]]|music=[[Ilaiyaraaja]]}}
== Soundtrack ==
{| class="wikitable"
! Song !! Singers !! Lyrics
|-
| "Vaa Vaa Vaa Kanna Vaa" || [[S. P. Balasubrahmanyam]] || [[Mu. Metha]]
|}`,
};

const REDIRECTS = { 'Nayagan': 'Nayakan' };

export function mockFetch(url) {
  const p = new URL(url).searchParams;
  let body;
  if (p.get('list') === 'categorymembers') {
    const cat = p.get('cmtitle');
    const members = {
      'Category:Tamil films': [{ ns: 0, title: 'Nayakan' }, { ns: 14, title: 'Category:Tamil films by year' }],
      'Category:Tamil films by year': [{ ns: 0, title: 'Velaikkaran (1987 film)' }, { ns: 14, title: 'Category:Tamil films' }],
    }[cat] ?? [];
    body = { query: { categorymembers: members.filter((m) => m.ns === 0 || p.get('cmtype').includes('subcat')) } };
  } else {
    const titles = p.get('titles').split('|');
    const redirects = titles.filter((t) => REDIRECTS[t]).map((t) => ({ from: t, to: REDIRECTS[t] }));
    const resolved = titles.map((t) => REDIRECTS[t] ?? t);
    const pages = resolved.map((t) => (PAGES[t]
      ? { title: t, revisions: [{ slots: { main: { content: PAGES[t] } } }] }
      : { title: t, missing: true }));
    // Simulate the API splitting content across responses: first response carries only
    // the first page's content, the continuation carries the rest.
    if (pages.length > 1 && !p.get('rvcontinue')) {
      body = { continue: { rvcontinue: 'x', continue: '||' }, query: { redirects, pages: pages.map((pg, i) => (i ? { title: pg.title } : pg)) } };
    } else if (p.get('rvcontinue')) {
      body = { query: { redirects, pages: pages.slice(1) } };
    } else {
      body = { query: { redirects, pages } };
    }
  }
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}
