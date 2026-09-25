import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractCorrections } from '../scripts/apply-correction.mjs';

const SCRIPT = new URL('../scripts/apply-correction.mjs', import.meta.url).pathname;
const body = (json) => `<!-- tamil-song-finder-correction -->\nFix\n\n\`\`\`json\n${json}\n\`\`\`\n\n**Source:** Wikipedia`;

test('extracts and validates corrections from an issue body', () => {
  const list = extractCorrections(body(JSON.stringify([
    { film: 'Naalu Veli Nilam', year: 1959, set: { musicDirectors: ['K. V. Mahadevan', 'M. K. Athmanathan'] } },
  ])));
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].set.musicDirectors, ['K. V. Mahadevan', 'M. K. Athmanathan']);
});

test('rejects malformed or hostile input with a readable reason', () => {
  assert.throws(() => extractCorrections('no json here'), /No ```json block/);
  assert.throws(() => extractCorrections(body('{ nope')), /isn't valid JSON/);
  assert.throws(() => extractCorrections(body('{"film":"X","set":{"__proto__":{"x":1},"script":"<b>"}}')), /Correction 1: .*can't be set/);
});

test('CLI appends to corrections.json once, even if the issue is applied twice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'corr-'));
  writeFileSync(join(dir, 'corrections.json'), '{"corrections":[]}');
  const issue = join(dir, 'issue.md');
  writeFileSync(issue, body('{"film":"Naalu Veli Nilam","year":1959,"song":"Kaani Nilam Vendum","set":{"musicDirectors":["M. K. Athmanathan"]}}'));
  const run = () => execFileSync(process.execPath, [SCRIPT, issue], { env: { ...process.env, DATASET_DIR: dir } }).toString();
  assert.match(run(), /Applied 1 correction/);
  assert.match(run(), /already applied/);
  assert.equal(JSON.parse(readFileSync(join(dir, 'corrections.json'))).corrections.length, 1);
});
