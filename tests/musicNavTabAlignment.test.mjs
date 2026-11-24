import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The Beats tab alone had `inline-flex min-h-11 items-center`, so its label was centred in a 44 px pill
// while the other tabs' labels sat at the top of the same row.
test('every music nav tab shares one height and vertical alignment', () => {
  const source = readFileSync(new URL('../app/veyrnox/_components/music/MusicPreviewShell.jsx', import.meta.url), 'utf8');
  const link = source.match(/<NavigationLink key=\{link\.href\}[^>]*className=\{`([^`]*)`\}/);
  assert.ok(link, 'the tab link is found');
  for (const cls of ['inline-flex', 'min-h-11', 'items-center']) {
    assert.ok(link[1].split(/\s+/).includes(cls), `every tab carries ${cls}`);
  }
  assert.doesNotMatch(link[1], /link\.beats \? 'inline-flex/, 'not only the Beats tab');
});
