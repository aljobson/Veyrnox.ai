import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { LEGAL_DATES, LEGAL_UPDATED, legalDateToIso } from '../lib/legalUpdated.mjs';
import { updated as terms } from '../lib/i18n/legal/terms.mjs';

const require = createRequire(import.meta.url);

test('legalDateToIso reads the printed legal date format', () => {
  assert.equal(legalDateToIso('17 November 2026'), '2026-11-17');
  assert.equal(legalDateToIso('7 November 2026'), '2026-11-07');
  assert.throws(() => legalDateToIso('Nov 17'));
});

test('footer date is the newest date of the legal documents', () => {
  const isos = Object.values(LEGAL_DATES).map(legalDateToIso);
  assert.equal(isos.length, 6);
  assert.equal(LEGAL_UPDATED, [...isos].sort().at(-1));
  assert.equal(legalDateToIso(terms) <= LEGAL_UPDATED, true);
});

test('the footer renders LEGAL_UPDATED, not the pricing date constant', () => {
  const footer = readFileSync(new URL('../app/veyrnox/_sections/footer.js', import.meta.url), 'utf8');
  assert.match(footer, /dateTime=\{LEGAL_UPDATED\}/);
  assert.match(footer, /formatUpdated\(LEGAL_UPDATED,/);
  assert.doesNotMatch(footer, /SITE_UPDATED/);
});

test('short legal paths redirect permanently to /legal/*', async () => {
  const { default: config } = await import('../next.config.mjs');
  const { match } = require('next/dist/compiled/path-to-regexp');
  const rules = await config.redirects();
  for (const doc of ['terms', 'privacy', 'refund', 'gdpr', 'aup']) {
    const rule = rules.find(r => match(r.source)(`/${doc}`));
    assert.ok(rule, doc);
    assert.equal(rule.permanent, true);
    assert.equal(rule.destination, '/legal/:doc');
    assert.ok(existsSync(new URL(`../app/legal/${doc}/page.js`, import.meta.url)), doc);
  }
  assert.equal(rules.some(r => match(r.source)('/legal/terms')), false);
});
