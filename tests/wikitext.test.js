import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePage, clean, toList, splitTopLevel, yearOf } from '../js/wikitext.js';

const SOUNDTRACK = `{{Infobox album
| name       = Roja
| type       = soundtrack
| artist     = [[A. R. Rahman]]
| released   = {{Start date|1992|8|15}}
}}
'''''Roja''''' is the soundtrack album to the 1992 [[Tamil cinema|Tamil]] film ''[[Roja (film)|Roja]]'', directed by [[Mani Ratnam]].

== Track listing ==
=== Tamil ===
{{Track listing
| extra_column = Singer(s)
| all_lyrics   = [[Vairamuthu]]
| title1 = Chinna Chinna Aasai
| extra1 = [[Minmini]]
| length1 = 4:57
| title2 = "Kadhal Rojave"
| extra2 = [[S. P. Balasubrahmanyam]], [[Sujatha Mohan|Sujatha]]<ref>{{cite web|url=x}}</ref>
| length2 = 5:03
}}
=== Hindi ===
{{Track listing
| headline = Hindi version
| extra_column = Singer(s)
| title1 = Dil Hai Chhota Sa
| extra1 = [[Minmini]]
}}
`;

const FILM = `{{Infobox film
| name           = Roja
| director       = [[Mani Ratnam]]
| starring       = {{Plainlist|
* [[Arvind Swamy]]
* [[Madhoo]]
}}
| music          = [[A. R. Rahman]]
| released       = {{Film date|1992|08|15}}
| language       = Tamil
}}
Roja is a 1992 film.
== Cast ==
{| class="wikitable"
! Actor !! Role
|-
| Arvind Swamy || Rishi
|}
`;

test('parses a soundtrack article, skipping other-language track lists', () => {
  const p = parsePage('Roja (soundtrack)', SOUNDTRACK);
  assert.equal(p.kind, 'soundtrack');
  assert.equal(p.film, 'Roja');
  assert.equal(p.year, 1992);
  assert.equal(p.filmLink, 'Roja (film)');
  assert.deepEqual(p.musicDirectors, ['A. R. Rahman']);
  assert.equal(p.songs.length, 2);
  assert.deepEqual(p.songs[1], {
    title: 'Kadhal Rojave',
    singers: ['S. P. Balasubrahmanyam', 'Sujatha'],
    lyricists: ['Vairamuthu'],
    musicDirectors: [],
    length: '5:03',
  });
});

test('parses a film infobox and ignores non-soundtrack tables', () => {
  const p = parsePage('Roja (film)', FILM);
  assert.equal(p.kind, 'film');
  assert.equal(p.film, 'Roja');
  assert.equal(p.year, 1992);
  assert.deepEqual(p.directors, ['Mani Ratnam']);
  assert.deepEqual(p.actors, ['Arvind Swamy', 'Madhoo']);
  assert.deepEqual(p.songs, []);
});

test('parses a soundtrack wikitable inside a film article', () => {
  const text = `{{Infobox film|name=Nayakan|director=[[Mani Ratnam]]|music=[[Ilaiyaraaja]]|released=1987}}
== Soundtrack ==
{| class="wikitable"
! No. !! Song !! Singers !! Lyrics !! Length
|-
| 1 || "Thenpandi Seemayile" || [[Ilaiyaraaja]] || Pulamaipithan || 4:30
|-
| 2 || style="text-align:left" | Nila Adhu || [[K. S. Chithra]]<br>[[Mano (singer)|Mano]] || Vaali || 5:00
|}
`;
  const p = parsePage('Nayakan', text);
  assert.equal(p.songs.length, 2);
  assert.equal(p.songs[0].title, 'Thenpandi Seemayile');
  assert.deepEqual(p.songs[1].singers, ['K. S. Chithra', 'Mano']);
  assert.deepEqual(p.songs[1].lyricists, ['Vaali']);
  assert.equal(p.songs[1].length, '5:00');
});

test('clean / toList helpers', () => {
  assert.equal(clean("''[[Foo (film)|Foo]]''<!-- x -->"), 'Foo');
  assert.deepEqual(toList('{{ubl|[[A. R. Rahman]]|[[Hariharan (singer)|Hariharan]]}}'), ['A. R. Rahman', 'Hariharan']);
  assert.deepEqual(toList('[[Hariharan]] and [[K. S. Chithra]] (duet)'), ['Hariharan', 'K. S. Chithra']);
  assert.deepEqual(splitTopLevel('a|[[b|c]]|{{d|e}}'), ['a', '[[b|c]]', '{{d|e}}']);
  assert.equal(yearOf('{{Film date|1995|03|10}}'), 1995);
  assert.equal(yearOf('unknown'), null);
});

test('placeholder names and stray quotes are dropped', () => {
  assert.deepEqual(toList('[[Vaali]] except where noted'), ['Vaali']);
  assert.deepEqual(toList('[[Mano]], Chorus'), ['Mano']);
  const p = parsePage('X', `{{Infobox film|name=X}}\n== Soundtrack ==\n{{Track listing|extra_column=Singer(s)|title1=Kannathil Kannam" (female version)|extra1=Instrumental}}`);
  assert.equal(p.songs[0].title, 'Kannathil Kannam (female version)');
  assert.deepEqual(p.songs[0].singers, []);
});

test('credit notes, role labels, feat. and table attributes are cleaned from names', () => {
  assert.deepEqual(toList('[[Vaali]] except "Idhazhin Oram" was written by [[Aishwarya Dhanush]]'), ['Vaali']);
  assert.deepEqual(toList('Sayanora Philip Backing vocal: Naresh Iyer'), ['Sayanora Philip', 'Naresh Iyer']);
  assert.deepEqual(toList('Background score: [[Viswanathan–Ramamoorthy]]'), ['Viswanathan–Ramamoorthy']);
  assert.deepEqual(toList('[[Yuvan Shankar Raja]] feat. [[G. V. Prakash Kumar]]'), ['Yuvan Shankar Raja', 'G. V. Prakash Kumar']);
  assert.deepEqual(toList('rowspan="3" | [[Vaali]]'), ['Vaali']);
  assert.deepEqual(toList('[Mangalampalli Balamurali Krishna]'), ['Mangalampalli Balamurali Krishna']);
  assert.equal(clean('Mandhiram Aavadhu Neeru<!--மந்திர மாவது'), 'Mandhiram Aavadhu Neeru');
});

test('a numbered "Track" column is not mistaken for the song title', () => {
  const text = `{{Infobox film|name=Winner}}
== Soundtrack ==
{| class="wikitable"
! Track !! Song !! Singers !! Lyricist
|-
| 1 || Engirundhai || [[Karthik (singer)|Karthik]] || [[Pa. Vijay]]
|}`;
  const p = parsePage('Winner', text);
  assert.equal(p.songs[0].title, 'Engirundhai');
  assert.deepEqual(p.songs[0].singers, ['Karthik']);
});

test('merged (rowspan/colspan) cells fill every row they cover', () => {
  // Shaped like Naalu Veli Nilam (1959): the composer cell spans several songs.
  const text = `{{Infobox film|name=Naalu Veli Nilam}}
== Soundtrack ==
{| class="wikitable"
! No. !! Song !! Singers !! Music !! Lyrics !! Length
|-
| 1 || Ooraar Urangaiyile || [[Thiruchi Loganathan]] & [[L. R. Eswari]] || rowspan="2" | [[K. V. Mahadevan]] || Folk Song || 03:21
|-
| 2 || Kulipen Panneerile || [[S. C. Krishnan]] & [[K. Jamuna Rani]] || [[A. Maruthakasi]] || 05:01
|-
| 3 || Kaani Nilam Vendum || [[Soolamangalam Rajalakshmi]] || [[M. K. Athmanathan]] || colspan="2" | 00:49
|}`;
  const [a, b, c] = parsePage('Naalu Veli Nilam', text).songs;
  assert.deepEqual(a.musicDirectors, ['K. V. Mahadevan']);
  assert.deepEqual(b.musicDirectors, ['K. V. Mahadevan']);
  assert.deepEqual(b.lyricists, ['A. Maruthakasi']);
  assert.equal(b.length, '05:01');
  assert.deepEqual(c.musicDirectors, ['M. K. Athmanathan']);
  assert.deepEqual(c.lyricists, []); // "00:49" is a duration, never a name
  assert.equal(c.length, '00:49');
});
