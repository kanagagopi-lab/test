// Tamil names and titles are romanised inconsistently ("Ilaiyaraaja" / "Ilayaraja",
// "Kadhal" / "Kaathal" / "Kadal"). `fold` reduces a string to a loose phonetic key so
// those variants compare equal.

const DIGRAPHS = [
  ['zh', 'l'], ['th', 't'], ['dh', 'd'], ['bh', 'b'], ['ph', 'p'], ['kh', 'k'],
  ['gh', 'g'], ['sh', 's'], ['ch', 's'], ['aiy', 'ay'], ['ou', 'u'], ['au', 'u'],
  ['ee', 'i'], ['oo', 'u'], ['w', 'v'], ['z', 's'], ['j', 's'], ['c', 'k'],
  ['q', 'k'], ['x', 'ks'], ['d', 't'], ['g', 'k'], ['b', 'p'], ['h', ''],
];

export function basic(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Names and titles repeat thousands of times across a library, so results are memoised.
const foldCache = new Map();
const wordsCache = new Map();

function memo(cache, key, fn) {
  let v = cache.get(key);
  if (v === undefined) {
    if (cache.size > 200000) cache.clear();
    v = fn(key);
    cache.set(key, v);
  }
  return v;
}

function foldUncached(s) {
  let t = basic(s).replace(/[^a-z0-9஀-௿]+/g, '');
  // Replacements apply in order (earlier rules must win, e.g. "th" before "h").
  for (const [from, to] of DIGRAPHS) if (t.includes(from)) t = t.split(from).join(to);
  return t.replace(/(.)\1+/g, '$1');
}

export function fold(s) {
  return memo(foldCache, String(s ?? ''), foldUncached);
}

// Split a string into folded words; empty words are dropped.
export function words(s) {
  return memo(wordsCache, String(s ?? ''), (k) => basic(k).split(/[^a-z0-9஀-௿]+/).map(fold).filter(Boolean));
}

// Common nicknames / abbreviations used by Tamil film fans.
export const ALIASES = {
  spb: 'S. P. Balasubrahmanyam',
  arr: 'A. R. Rahman',
  msv: 'M. S. Viswanathan',
  tms: 'T. M. Soundararajan',
  kjy: 'K. J. Yesudas',
  yesudas: 'K. J. Yesudas',
  raja: 'Ilaiyaraaja',
  isaignani: 'Ilaiyaraaja',
  yuvan: 'Yuvan Shankar Raja',
  harris: 'Harris Jayaraj',
  gvm: 'Gautham Vasudev Menon',
  gvp: 'G. V. Prakash Kumar',
  mgr: 'M. G. Ramachandran',
  sivaji: 'Sivaji Ganesan',
  thalaivar: 'Rajinikanth',
  rajini: 'Rajinikanth',
  kamal: 'Kamal Haasan',
  ulaganayagan: 'Kamal Haasan',
  thalapathy: 'Vijay',
  thala: 'Ajith Kumar',
  janaki: 'S. Janaki',
  chithra: 'K. S. Chithra',
  susheela: 'P. Susheela',
  kannadasan: 'Kannadasan',
  anirudh: 'Anirudh Ravichander',
  str: 'Silambarasan',
  simbu: 'Silambarasan',
};

export function expandAlias(term) {
  const key = basic(term).replace(/[^a-z]/g, '');
  return ALIASES[key] ?? term;
}
