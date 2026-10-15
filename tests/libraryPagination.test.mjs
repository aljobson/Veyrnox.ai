import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('older Library requests are guarded against duplicate clicks, account changes and unmounts', () => {
  const source = readFileSync(new URL('../app/veyrnox/_lib/useOlderLibraryJobs.js', import.meta.url), 'utf8');
  assert.match(source, /!actor \|\| !nextCursor \|\| request\.current/);
  assert.match(source, /getStoredUserId\(\) === actor/);
  assert.match(source, /return \(\) => \{ request\.current = null; \}/);
  assert.match(source, /if \(!current\(\)\) return/);
  assert.match(source, /Older jobs could not be loaded/);
});

test('source picker keeps unshown candidates and reads the next keyset page instead of stopping at recent images', () => {
  const source = readFileSync(new URL('../app/veyrnox/_components/LibraryPicker.js', import.meta.url), 'utf8');
  assert.match(source, /const queue = \[\]/);
  assert.match(source, /jobsPagePath\(cursor, 48\)/);
  assert.match(source, /queue\.length > 0 \|\| !!cursor/);
  assert.match(source, /checked\+\+ < SHOWN \* 2/);
  assert.match(source, /Load older \$\{plural\}/);
  assert.match(source, /disabled=\{loading\}/);
  assert.match(source, /onSessionChange, getStoredUserId/);
});
