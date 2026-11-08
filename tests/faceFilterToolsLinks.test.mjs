import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FACE_FILTER_LINKS } from '../app/veyrnox/_lib/creativeFeatures.js';
import { TOOL_TASKS } from '../app/veyrnox/_lib/tools.js';

const ACTIVE = ['face-retouch', 'face-enhance', 'face-makeup', 'face-age'];

test('in-app Tools lists the four active face filters', () => {
  assert.deepEqual(FACE_FILTER_LINKS.map((f) => f.id), ACTIVE);
  for (const f of FACE_FILTER_LINKS) assert.ok(f.title && f.blurb);
});

test('every in-app face filter is also in the public /tools face-filters group', () => {
  const group = TOOL_TASKS.find((t) => t.key === 'face-filters');
  for (const id of ACTIVE) assert.ok(group.ids.includes(id), id);
});

test('/app/features renders a card per filter linking to Create with that model', async () => {
  const src = await readFile(new URL('../app/veyrnox/app/features/page.js', import.meta.url), 'utf8');
  assert.match(src, /FACE_FILTER_LINKS\.map/);
  assert.match(src, /`\/app\/create\?model=\$\{encodeURIComponent\(f\.id\)\}`/);
});
