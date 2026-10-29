import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
// Keep this copy-table test independent of browser auth; only the two unrelated account constants are stubbed.
const source = readFileSync(new URL('../app/veyrnox/_lib/createErrors.js',import.meta.url),'utf8')
  .replace(/^import .* from '\.\/gateway';/m,"const ACCOUNT_PAUSED_COPY = '', ACCOUNT_ON_HOLD_COPY = '';");
const { ERROR_COPY } = await import('data:text/javascript,'+encodeURIComponent(source));
const codes = ['source_too_short','source_resolution_out_of_range','source_count_exceeded','sources_too_large','source_size_unknown','references_invalid','references_ambiguous','body_too_large','idempotency_conflict'];
for (const code of codes) test(`${code} has actionable web copy in all eleven catalogs`, async () => {
  assert.ok(ERROR_COPY[code]?.length > 30);
  assert.match(ERROR_COPY[code], /Remove|Reattach|Clear|Shorten|Open Library|Use a clip/);
  for (const locale of ['en','es','zh','hi','ar','fr','pt','ru','ja','de','ko']) {
    const {default: direct} = await import(`../lib/i18n/messages/app/${locale}/data-errors.mjs`);
    const key = `app.create.error.${code}`;
    assert.ok(direct[key]?.length > 10,`${locale}: ${code} must not silently fall back`);
    assert.equal((await appMessagesFor(locale))[key],direct[key]);
    if(locale==='en')assert.equal(direct[key],ERROR_COPY[code]);
    else assert.notEqual(direct[key],ERROR_COPY[code]);
  }
});
