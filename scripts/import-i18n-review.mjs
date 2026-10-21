// node scripts/import-i18n-review.mjs <sheet.csv> [--dry]
// Applies a reviewer's corrections (ADR-0107): every row whose Verdict is "fix"
// and whose Corrected text is filled replaces that key in the language's
// catalog. Placeholders are checked against English before anything is written;
// a bad row stops the whole import so a catalog is never left half-changed.
import { readFileSync, writeFileSync } from 'node:fs';
import { checkCatalog } from '../lib/i18n/check.mjs';
import { CATALOGS } from '../lib/i18n/translate.mjs';
const en = CATALOGS.en;
import { LOCALES } from '../lib/i18n/locales.mjs';

const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/import-i18n-review.mjs <review-xx.csv> [--dry]');
  process.exit(2);
}
const dry = flag === '--dry';

/** Minimal RFC 4180 reader: quoted cells, doubled quotes, newlines inside cells. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some((x) => x !== '')) rows.push(row); }
  return rows;
}

const rows = parseCsv(readFileSync(file, 'utf8').replace(/^﻿/, ''));
const header = rows.shift();
const col = (name) => header.findIndex((h) => h.toLowerCase().startsWith(name));
const [kKey, kLang, kVerdict, kFixed] = [col('key'), header.findIndex((h) => /\(([a-z]{2})\)$/.test(h)), col('verdict'), col('corrected')];
if ([kKey, kLang, kVerdict, kFixed].includes(-1)) { console.error('not a review sheet: columns missing'); process.exit(2); }
const code = /\(([a-z]{2})\)$/.exec(header[kLang])[1];
if (!LOCALES.some((l) => l.code === code && code !== 'en')) { console.error(`unknown language ${code}`); process.exit(2); }

const next = { ...CATALOGS[code] };
let changed = 0;
for (const r of rows) {
  if (!/^fix/i.test(r[kVerdict] || '')) continue;
  const key = r[kKey];
  const text = (r[kFixed] || '').trim();
  if (!(key in en)) { console.error(`unknown key "${key}"`); process.exit(1); }
  if (!text) { console.error(`"${key}" is marked fix but has no corrected text`); process.exit(1); }
  if (next[key] !== text) { next[key] = text; changed += 1; }
}

const problems = checkCatalog(en, next, code);
if (problems.length) { problems.forEach((p) => console.error(p)); process.exit(1); }
if (changed === 0) { console.log(`${code}: nothing to change`); process.exit(0); }
if (dry) { console.log(`${code}: ${changed} correction(s) would be applied (dry run)`); process.exit(0); }

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
// Replace only the corrected lines, so the diff shows exactly what a reviewer
// changed (one entry per line in every catalog).
// Preset recipe copy lives in its own per-language files; every other key is in the catalog file.
const fileFor = (key) => (key.startsWith('presets.needs.') ? `presets/${code}/needs.mjs`
  : key.startsWith('presets.steps.') ? `presets/${code}/steps.mjs` : `${code}.mjs`);
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sources = new Map();
for (const key of Object.keys(next)) {
  if (next[key] === CATALOGS[code][key]) continue;
  const name = fileFor(key);
  const path = new URL(`../lib/i18n/messages/${name}`, import.meta.url);
  let source = sources.get(name)?.source ?? readFileSync(path, 'utf8');
  const line = new RegExp(`^(\\s*)(['"])${escapeRe(key)}\\2:.*$`, 'm');
  if (!line.test(source)) { console.error(`${code}: "${key}" has no single-line entry to replace`); process.exit(1); }
  const trailing = /,\s*$/.test(source.match(line)[0]) ? ',' : '';
  source = source.replace(line, (_, indent) => `${indent}${q(key)}: ${q(next[key])}${trailing}`);
  sources.set(name, { path, source });
}
for (const { path, source } of sources.values()) writeFileSync(path, source);
console.log(`${code}: applied ${changed} correction(s)`);
