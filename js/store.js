// Imported films live in the browser so the library survives reloads. IndexedDB holds the
// whole catalogue (hundreds of MB allowed); localStorage (~5 MB) is only a fallback.
// Each film record is keyed by its Wikipedia URL (or film+year) so re-imports replace.

const LS_KEY = 'tamil-song-finder:library:v1';
const DB = 'tamil-song-finder';
const STORE = 'library';

export function filmKey(f) {
  return f.wiki || `${f.film}|${f.year ?? ''}`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function lsGet() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function loadLibrary() {
  try {
    const films = await idb('readonly', (s) => s.get('films'));
    if (films) return films;
    // One-time migration from the earlier localStorage library.
    const old = lsGet();
    if (old?.length && await saveLibrary(old)) {
      try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
    }
    return old ?? [];
  } catch {
    return lsGet() ?? [];
  }
}

// Resolves to true when saved.
export async function saveLibrary(films) {
  try {
    await idb('readwrite', (s) => s.put(films, 'films'));
    return true;
  } catch {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(films));
      return true;
    } catch {
      return false;
    }
  }
}

export function mergeFilms(existing, incoming) {
  const map = new Map(existing.map((f) => [filmKey(f), f]));
  for (const f of incoming) map.set(filmKey(f), f);
  return [...map.values()];
}

export async function clearLibrary() {
  try { await idb('readwrite', (s) => s.delete('films')); } catch { /* ignore */ }
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

// Corrections made in this browser (see corrections.js). Kept until cleared, so they keep
// applying even before (or without) being submitted to the shared data/corrections.json.
const LS_CORR = 'tamil-song-finder:corrections:v1';

export async function loadLocalCorrections() {
  try {
    return (await idb('readonly', (s) => s.get('corrections'))) ?? [];
  } catch {
    try { return JSON.parse(localStorage.getItem(LS_CORR) ?? '[]'); } catch { return []; }
  }
}

export async function saveLocalCorrections(list) {
  try {
    await idb('readwrite', (s) => s.put(list, 'corrections'));
    return true;
  } catch {
    try { localStorage.setItem(LS_CORR, JSON.stringify(list)); return true; } catch { return false; }
  }
}
