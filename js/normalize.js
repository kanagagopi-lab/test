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

export function fold(s) {
  let t = basic(s).replace(/[^a-z0-9஀-௿]+/g, '');
  for (const [from, to] of DIGRAPHS) t = t.split(from).join(to);
  return t.replace(/(.)\1+/g, '$1');
}

// Split a query into folded words; empty words are dropped.
export function words(s) {
  return basic(s).split(/[^a-z0-9஀-௿]+/).map(fold).filter(Boolean);
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
