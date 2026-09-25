# Tamil Song Finder

A web app for identifying Tamil film songs. You search by any combination of:

- song title
- movie
- actors / actresses
- music director
- lyricist
- singers
- movie director
- release year range
- free text across all fields

## Features

- **Tolerant matching.** Tamil romanisation varies, so `Ilayaraja` finds *Ilaiyaraaja*, `Kaathal` finds *Kadhal*, and `AR Rahman` finds *A. R. Rahman*. Common nicknames also work: `SPB`, `ARR`, `MSV`, `TMS`, `Raja`, `Rajini`, `Kamal`, `GVM`…
- **Several names in one field.** Separate names with commas to require all of them. For example, singers `SPB, Janaki` finds their duets.
- **Refine panel.** It shows the most common music directors, lyricists, singers, actors, directors and movies in the current results. Click any name (in the panel or on a song) to add it as a filter.
- **Shareable searches.** Filters are kept in the URL, e.g. `?musicDirectors=Ilaiyaraaja&singers=SPB`.
- **Listen.** Each song links to a YouTube search, a Gaana search and its Wikipedia article.

## Data

| Source | How it's used |
| --- | --- |
| `data/seed.json` | A hand-curated starter set of about 40 well-known films and 85 songs, spanning the 1960s to the 2020s. |
| [Wikipedia: Tamil film soundtracks](https://en.wikipedia.org/wiki/Category:Tamil_film_soundtracks) | Import it from the **Library** panel in the app. Your browser calls the Wikipedia API directly, parses each soundtrack's track listing (songs, singers, lyricists) and the linked film article (director, cast, music director, year). The imported songs are saved in the browser's localStorage. You can also import any other category or a list of film or soundtrack article titles. |
| `data/wikipedia.json` (optional) | A prebuilt dump that the app loads automatically if it's present. Generate it with `npm run build-data`. |
| [Gaana](https://gaana.com/album/tamil) | Gaana has no public API and doesn't allow cross-site requests, so each song links to a Gaana search instead of importing its catalogue. |

To ship a bigger dataset with the app, run this on a machine with internet access and commit the result:

```sh
npm run build-data                                   # whole category → data/wikipedia.json
node scripts/build-dataset.mjs --limit 200           # first 200 articles only
node scripts/build-dataset.mjs --titles "Nayakan,Anniyan (soundtrack)"
```

Wikipedia text is licensed under CC BY-SA 4.0.

## Running

The app is static HTML, CSS and JavaScript (ES modules) with no build step and no dependencies. It must be served over HTTP; opening `index.html` directly from disk won't work.

```sh
npm start            # python3 -m http.server 8000 → http://localhost:8000
npm test             # node --test (parser, search and importer tests)
```

It can be hosted as-is on GitHub Pages or any other static host.

## Layout

```
index.html               page shell
css/styles.css           styles (light and dark themes, mobile layout)
js/app.js                UI: form, results, facets, library/import panel
js/search.js             flattening, de-duplication, indexing, multi-field search, facets
js/normalize.js          phonetic folding of romanised Tamil, nickname aliases
js/wikitext.js           parser for Infobox film/album, Track listing and soundtrack tables
js/wikipedia.js          Wikipedia API client and importer (browser and Node)
js/store.js              localStorage persistence for imported films
scripts/build-dataset.mjs  Node CLI that builds data/wikipedia.json
data/seed.json           curated starter set
tests/                   node:test suites
```
