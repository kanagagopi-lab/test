#!/usr/bin/env node
// Adds the corrections in a GitHub issue body to data/corrections.json.
// Used by .github/workflows/corrections.yml; the issue body is untrusted input, so it is
// only ever parsed as JSON and validated field by field, never executed.
//
//   node scripts/apply-correction.mjs <file-with-issue-body>
// Prints a Markdown summary to stdout; exits 1 with a readable error on invalid input.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCorrection } from '../js/corrections.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(process.env.DATASET_DIR ?? join(ROOT, 'data'), 'corrections.json');

export function extractCorrections(body) {
  const blocks = [...String(body).matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  if (!blocks.length) throw new Error('No ```json block found in the issue.');
  let data;
  try {
    data = JSON.parse(blocks[0]);
  } catch (err) {
    throw new Error(`The json block isn't valid JSON: ${err.message}`);
  }
  const list = Array.isArray(data) ? data : data?.corrections ?? [data];
  if (!list.length || list.length > 100) throw new Error('Expected between 1 and 100 corrections.');
  return list.map((c, i) => {
    try {
      return validateCorrection(c);
    } catch (err) {
      throw new Error(`Correction ${i + 1}: ${err.message}`);
    }
  });
}

const describe = (c) => `${c.film}${c.year ? ` (${c.year})` : ''}${c.song ? ` – ${c.song}` : ''}: ${
  c.delete ? 'remove' : Object.entries(c.set).map(([k, v]) => `${k} → ${Array.isArray(v) ? v.join(', ') : v}`).join('; ')}`;

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const list = extractCorrections(await readFile(process.argv[2], 'utf8'));
    const current = JSON.parse(await readFile(FILE, 'utf8').catch(() => '{"corrections":[]}'));
    const seen = new Set(current.corrections.map((c) => JSON.stringify(c)));
    const added = list.filter((c) => !seen.has(JSON.stringify(c)));
    current.corrections.push(...added);
    await writeFile(FILE, `${JSON.stringify(current, null, 1)}\n`);
    console.log(added.length
      ? `Applied ${added.length} correction(s):\n\n${added.map((c) => `- ${describe(c)}`).join('\n')}`
      : 'These corrections were already applied.');
  } catch (err) {
    console.log(`Couldn't apply this correction: ${err.message}`);
    process.exit(1);
  }
}
