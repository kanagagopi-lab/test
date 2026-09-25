// Imported films live in the browser (localStorage) so the library survives reloads.
// Each film record is keyed by its Wikipedia URL (or film+year) so re-imports replace.

const KEY = 'tamil-song-finder:library:v1';

function filmKey(f) {
  return f.wiki || `${f.film}|${f.year ?? ''}`;
}

export function loadLibrary() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLibrary(films) {
  try {
    localStorage.setItem(KEY, JSON.stringify(films));
    return true;
  } catch {
    return false;
  }
}

export function mergeFilms(existing, incoming) {
  const map = new Map(existing.map((f) => [filmKey(f), f]));
  for (const f of incoming) map.set(filmKey(f), f);
  return [...map.values()];
}

export function clearLibrary() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
