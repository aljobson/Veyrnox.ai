import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('security.txt is RFC 9116-shaped and points to the canonical HTTPS copy', () => {
  const source = readFileSync(new URL('../public/.well-known/security.txt', import.meta.url), 'utf8');
  assert.match(source, /^Contact: mailto:/m);
  assert.match(source, /^Expires: 2027-/m);
  assert.match(source, /^Canonical: https:\/\/veyrnox\.ai\/\.well-known\/security\.txt$/m);
});

test('Next.js technology advertising is disabled', () => {
  const config = readFileSync(new URL('../next.config.mjs', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(config, /poweredByHeader: false/);
  assert.match(worker, /stripTechnologyHeaders\(response\)/);
});
