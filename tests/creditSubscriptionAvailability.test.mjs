import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/veyrnox/_components/CreditSubscriptions.js', import.meta.url), 'utf8');

test('closed subscription sales are explained on public Pricing and account billing', () => {
  assert.match(source, /Monthly subscriptions aren(?:&apos;|’)t open right now/);
  assert.match(source, /One-off Credit Packs can be purchased separately when available and do not renew/);
  assert.doesNotMatch(source, /Credit Packs\s+are available/);
  assert.doesNotMatch(source, /if \(loaded && closed && !sub && !recovery\) return null/);
  assert.doesNotMatch(source, /\.catch\(\(\) => \{\}\)/);
});

test('the public subscription offer distinguishes loading, open, closed and unavailable', () => {
  for (const phase of ['loading', 'open', 'closed', 'unavailable']) {
    assert.match(source, new RegExp(`'${phase}'`));
  }
  assert.match(source, /Loading monthly subscription prices/);
  assert.match(source, /Monthly subscription prices are temporarily unavailable/);
  assert.match(source, /Refresh monthly prices/);
});
