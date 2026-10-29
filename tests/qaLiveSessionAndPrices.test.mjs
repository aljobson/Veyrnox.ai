import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// QA 2026-10-29: two client components read state once on mount and showed the wrong thing.
const code = (path) => readFileSync(path, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('the Vibe check waits for the cookie session instead of reading memory on mount', () => {
  const src = code('app/veyrnox/_components/VibeCheck.js');
  // After a full page load the access token is restored asynchronously, so getSession() on mount is null for
  // people who are signed in, and the page asked them to sign in.
  assert.doesNotMatch(src, /getSession\(\)/);
  assert.match(src, /getFreshAccessToken\(\)\.then/);
  assert.match(src, /onSessionChange\(/);
});

test('the header Models menu prints prices from the live catalog only', () => {
  const src = code('app/veyrnox/_components/ModelsMenu.js');
  assert.match(src, /useCatalog\(\)/);
  assert.doesNotMatch(src, /\{model\.credits\} cr/, 'the built-in price list drifted from the catalog');
  assert.match(src, /livePrice\.get\(model\.id\)/);
});
