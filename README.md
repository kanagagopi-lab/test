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
| `data/wikipedia/*.json` | Bundled datasets built from Wikipedia: one file per decade, plus optional category files. The app loads everything listed in `data/datasets.json`. |
| Library panel (in the app) | Imports straight from Wikipedia in your browser and saves to IndexedDB on your device. |
| [Gaana](https://gaana.com/album/tamil) | Gaana has no public API and doesn't allow cross-site requests, so each song links to a Gaana search instead of importing its catalogue. |

### Where the songs come from on Wikipedia

1. **Year lists.** The pages *List of Tamil films of 1931* through *List of Tamil films of <this year>* (plus the decade pages for early years) list almost every Tamil film. Film titles are read from their tables.
2. **Film articles.** Each film's infobox gives the director, cast, music director and year. Its *Soundtrack* / *Music* section gives the songs (a `{{Track listing}}` template or a songs table).
3. **Soundtrack articles.** When a film's songs live on a separate "(soundtrack)" article, it is followed automatically. The reverse also works: importing a soundtrack article pulls cast and director from its film article.
4. **Categories.** Any category can be imported, such as [Tamil film soundtracks](https://en.wikipedia.org/wiki/Category:Tamil_film_soundtracks) or *Tamil-language films*, optionally descending into subcategories.

Wikipedia only has song lists for some films, especially older ones, so coverage grows as Wikipedia improves. Just re-run the build.

## Getting all the songs

### Option 1: GitHub Action (no setup)

1. Open the repository on GitHub, then go to **Actions → Build song dataset → Run workflow**.
2. Keep the default year range `1931-2026` and click **Run workflow**.

GitHub's servers fetch everything from Wikipedia, which takes some time. The workflow then commits `data/wikipedia/*.json` and `data/datasets.json` to the branch. It also refreshes the two most recent decades on the 1st of every month.

### Option 2: on your computer (Node 18+)

```sh
npm run build-data                                           # all years, 1931 → today, one file per decade
node scripts/build-dataset.mjs --years 1990-1999 --force     # rebuild one decade
node scripts/build-dataset.mjs --category "Category:Tamil film soundtracks"
node scripts/build-dataset.mjs --category "Category:Tamil-language films" --depth 2
node scripts/build-dataset.mjs --titles "Nayakan,Anniyan (soundtrack)" --out data/wikipedia/extra.json
git add data && git commit -m "Update song dataset" && git push
```

Decades that already have a file are skipped. If a run is interrupted, run the same command again and it resumes.

### Option 3: in the browser

Open **Library** at the bottom of the app, then use **Import films by year**, **Import category** or **Import articles**. Imports go in batches of 100 articles and are saved after each batch. **Stop import** halts the run, and running it again skips films you already have. Use **Export library** to save what you imported as JSON, for example to commit it as a bundled dataset.

Wikipedia text is licensed under CC BY-SA 4.0.

## Correcting mistakes

Wikipedia and the importer are both imperfect, so every song has a **Correct this** link. It opens a form with the song's details (title, singers, lyricists, music director) and the movie's (name, year, director, actors, and a music director for every song). There's also an option to remove a song that doesn't belong to the movie.

- **Save on this device.** The fix applies immediately in your browser and is re-applied on every visit.
- **Save & submit to GitHub.** This also opens a pre-filled GitHub issue containing the correction as JSON. The **Apply corrections** workflow (`.github/workflows/corrections.yml`) validates it, adds it to `data/corrections.json`, commits, closes the issue, and the site redeploys. Issues from the repository owner or collaborators are applied at once; anyone else's wait until a maintainer adds the `approved` label.

Corrections are layered on top of the Wikipedia data every time the app loads, so they survive the monthly dataset rebuilds. You can also edit `data/corrections.json` by hand:

```json
{ "corrections": [
  { "film": "Naalu Veli Nilam", "year": 1959,
    "set": { "musicDirectors": ["K. V. Mahadevan", "M. K. Athmanathan"] } },
  { "film": "Naalu Veli Nilam", "year": 1959, "song": "Kaani Nilam Vendum",
    "set": { "musicDirectors": ["M. K. Athmanathan"] } },
  { "film": "Some Film", "song": "Wrong Song", "delete": true }
] }
```

- **Film-level entries** (no `"song"`) can set `film`, `year`, `directors`, `actors`, `musicDirectors` and `lyricists`. Setting `musicDirectors` or `lyricists` on a film also replaces the per-song values, except for songs that have their own correction.
- **Song-level entries** can set `title`, `singers`, `lyricists`, `musicDirectors` and `length`.
- **Missing entries are added.** A song or film that doesn't exist yet is created.
- **`"delete": true`** removes a song, or a whole film if there's no `"song"`.

If Wikipedia itself is wrong, please fix it there too; the next rebuild picks the fix up for everyone.

## Running

The app is static HTML, CSS and JavaScript (ES modules) with no build step and no dependencies. It must be served over HTTP; opening `index.html` directly from disk won't work.

```sh
npm start            # python3 -m http.server 8000 → http://localhost:8000
npm test             # node --test (parser, search and importer tests)
```

### Publishing on GitHub Pages

`.github/workflows/pages.yml` runs the tests and publishes the site on every push, and again after each dataset build. It needs a one-time setting: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site is then live at `https://<owner>.github.io/<repo>/`. Any other static host works too; just upload `index.html`, `css/`, `js/` and `data/`.

## Layout

```
index.html               page shell
css/styles.css           styles (light and dark themes, mobile layout)
js/app.js                UI: form, results, facets, library/import panel
js/search.js             flattening, de-duplication, indexing, multi-field search, facets
js/normalize.js          phonetic folding of romanised Tamil, nickname aliases
js/wikitext.js           parser for Infobox film/album, Track listing and soundtrack tables
js/wikipedia.js          Wikipedia API client and importer (browser and Node)
js/store.js              IndexedDB persistence for imported films and local corrections
js/corrections.js        validating and applying manual corrections
scripts/build-dataset.mjs  Node CLI that builds data/wikipedia/*.json + data/datasets.json
.github/workflows/       GitHub Action that runs the builder and commits the data
data/seed.json           curated starter set
data/datasets.json       list of dataset files the app loads
data/corrections.json    manual corrections applied on top of the data
scripts/apply-correction.mjs  turns a correction issue into a data/corrections.json entry
tests/                   node:test suites
```
