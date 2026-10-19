import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import en from '../lib/i18n/messages/en.mjs';
import { LOCALES } from '../lib/i18n/locales.mjs';

const run = (script, ...args) => spawnSync('node', [`scripts/${script}`, ...args], { encoding: 'utf8' });

test('the review export writes one sheet per language with every key and a policy-first order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'i18n-review-'));
  execFileSync('node', ['scripts/export-i18n-review.mjs', dir]);
  for (const l of LOCALES.filter((x) => x.code !== 'en')) {
    const sheet = readFileSync(join(dir, `review-${l.code}.csv`), 'utf8');
    assert.ok(sheet.startsWith('﻿'), `${l.code} has a BOM for spreadsheet apps`);
    const lines = sheet.trim().split('\n');
    assert.ok(lines.length > Object.keys(en).length, `${l.code} lists every key (cells may hold newlines)`);
  }
  assert.match(readFileSync(join(dir, 'README.txt'), 'utf8'), /Priority 1/);
});

test('importing a sheet with no fixes changes nothing; a bad placeholder is refused before any write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'i18n-review-'));
  execFileSync('node', ['scripts/export-i18n-review.mjs', dir]);
  const sheet = join(dir, 'review-de.csv');
  assert.match(run('import-i18n-review.mjs', sheet, '--dry').stdout, /nothing to change/);

  // Mark one row "fix" with a placeholder the English does not have.
  const text = readFileSync(sheet, 'utf8').split('\n');
  const at = text.findIndex((line) => line.includes(',"home.cta.title",'));
  assert.ok(at > 0, 'the row is on the sheet');
  assert.ok(text[at].endsWith(',"","",""'), 'the three reviewer columns are empty');
  text[at] = `${text[at].slice(0, -',"","",""'.length)},"fix","Mach {x} heute.",""`;
  const bad = join(dir, 'bad.csv');
  writeFileSync(bad, text.join('\n'));
  const refused = run('import-i18n-review.mjs', bad, '--dry');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /slots/);
});
