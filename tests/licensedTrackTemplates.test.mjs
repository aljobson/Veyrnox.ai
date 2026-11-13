import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LICENSED_MUSIC_CATEGORIES, LICENSED_MUSIC_TRACKS } from '../lib/licensedMusicCatalog.js';
import { MUSIC_SAMPLE_DIRECTION_MAX } from '../lib/musicDiscover.js';
import {
  LICENSED_CATEGORY_DIRECTIONS, licensedTemplateFor, licensedTemplateHref, resolveInitialDescription,
} from '../lib/licensedTrackTemplates.js';

const categories = LICENSED_MUSIC_CATEGORIES.filter((name) => name !== 'All');

test('every catalog category has a direction within the description limit', () => {
  assert.equal(categories.length, 21);
  assert.deepEqual(Object.keys(LICENSED_CATEGORY_DIRECTIONS).sort(), [...categories].sort());
  for (const category of categories) {
    const direction = LICENSED_CATEGORY_DIRECTIONS[category];
    assert.ok(direction.trim().length > 20, category);
    assert.ok(direction.length <= MUSIC_SAMPLE_DIRECTION_MAX, `${category} is ${direction.length} characters`);
  }
});

test('directions never name a catalog track or creator', () => {
  const directions = Object.values(LICENSED_CATEGORY_DIRECTIONS).join('\n').toLowerCase();
  for (const track of LICENSED_MUSIC_TRACKS) {
    for (const word of [track.title, track.creator]) {
      if (word.length > 3) assert.ok(!directions.includes(word.toLowerCase()), `"${word}" appears in a direction`);
    }
  }
  assert.ok(!/in the style of|sounds like|like the song/.test(directions));
});

test('every track resolves to a template that carries its own credit', () => {
  for (const track of LICENSED_MUSIC_TRACKS) {
    const template = licensedTemplateFor(track.id);
    assert.equal(template.id, track.id);
    assert.equal(template.attribution, track.attribution);
    assert.equal(template.direction, LICENSED_CATEGORY_DIRECTIONS[track.category]);
    assert.equal(licensedTemplateHref(track.id), `/app/music/create?template=${track.id}`);
  }
});

test('unknown, malformed and non-string ids resolve to nothing', () => {
  for (const bad of [undefined, null, 42, '', 'nope', '../etc/passwd', 'a b', 'x'.repeat(200), ['savfk-rounding'], { id: 'savfk-rounding' }]) {
    assert.equal(licensedTemplateFor(bad), null, String(bad));
    assert.equal(licensedTemplateHref(bad), null, String(bad));
  }
});

test('an explicit sample or template beats the stored public draft', () => {
  const template = licensedTemplateFor('savfk-rounding');
  const saved = 'a stored public prompt';
  assert.equal(resolveInitialDescription({ licensedTemplate: template, savedPrompt: saved }), template.direction);
  assert.equal(resolveInitialDescription({ sampleSeed: { id: 'x' }, licensedTemplate: template, savedPrompt: saved }), '');
  assert.equal(resolveInitialDescription({ sampleSeed: { id: 'x' }, savedPrompt: saved }), '');
  assert.equal(resolveInitialDescription({ savedPrompt: `  ${saved}  ` }), saved);
  assert.equal(resolveInitialDescription({ savedPrompt: 'x'.repeat(501) }), '');
  assert.equal(resolveInitialDescription({}), '');
  assert.equal(resolveInitialDescription(), '');
});

test('the quote hook advances a revision on clear and on request, and drops stale responses', () => {
  const source = readFileSync(new URL('../app/veyrnox/_components/music/useMusicServerState.js', import.meta.url), 'utf8');
  assert.match(source, /const clearQuote = useCallback\(\(\) => \{\s*quoteRevision\.current \+= 1;/);
  assert.match(source, /if \(quoteRevision\.current !== mine\) return null;\s*setQuote\(next\);/);
  assert.match(source, /if \(lastQuoteRequest\.current === mine\) setBusy\(''\);/);
});

test('the Create page ignores a template when a sample is present', () => {
  const source = readFileSync(new URL('../app/veyrnox/app/music/create/page.js', import.meta.url), 'utf8');
  assert.match(source, /sampleSeed \? null : licensedTemplateFor\(/);
});

test('the server studio consumes the stored draft without overriding a handoff', () => {
  const source = readFileSync(new URL('../app/veyrnox/_components/music/MusicServerStudio.jsx', import.meta.url), 'utf8');
  assert.match(source, /if \(!sampleSeed && !licensedTemplate && restored\) setDescription\(restored\);\s*sessionStorage\.removeItem\(MUSIC_PUBLIC_DRAFT_KEY\);/);
});
