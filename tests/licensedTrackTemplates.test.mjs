import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LICENSED_MUSIC_CATEGORIES, LICENSED_MUSIC_TRACKS } from '../lib/licensedMusicCatalog.js';
import { MUSIC_SAMPLE_DIRECTION_MAX } from '../lib/musicDiscover.js';
import { createQuoteGate } from '../lib/quoteRevisionGate.js';
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

test('a quote that finishes after an invalidation is not current', () => {
  const gate = createQuoteGate();
  const first = gate.start();
  assert.equal(gate.isCurrent(first), true);
  gate.invalidate(); // template removed, mode switched or input edited
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isLatestStart(first), true, 'busy state must still clear for the latest request');
});

test('a newer request supersedes an older one and only the newest clears busy', () => {
  const gate = createQuoteGate();
  const older = gate.start();
  const newer = gate.start();
  assert.equal(gate.isCurrent(older), false);
  assert.equal(gate.isLatestStart(older), false);
  assert.equal(gate.isCurrent(newer), true);
  assert.equal(gate.isLatestStart(newer), true);
});

test('slow preparation (a delayed draft save) cannot outlive a removal or mode switch', async () => {
  const gate = createQuoteGate();
  const startedAt = gate.current();
  const save = new Promise((resolve) => setTimeout(resolve, 5));
  gate.invalidate(); // the person switches mode and removes the template during the save
  await save;
  assert.equal(gate.unchanged(startedAt), false, 'the request must not be made');
  const untouched = createQuoteGate();
  const before = untouched.current();
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(untouched.unchanged(before), true);
});

test('the hook and Custom review wire the gate, and removal clears the whole direction', () => {
  const hook = readFileSync(new URL('../app/veyrnox/_components/music/useMusicServerState.js', import.meta.url), 'utf8');
  assert.match(hook, /gate\.invalidate\(\);\s*setQuote\(null\);/);
  assert.match(hook, /if \(startedAt !== undefined && !gate\.unchanged\(startedAt\)\) return null;/);
  assert.match(hook, /if \(!gate\.isCurrent\(mine\)\) return null;\s*setQuote\(next\);/);
  const studio = readFileSync(new URL('../app/veyrnox/_components/music/MusicServerStudio.jsx', import.meta.url), 'utf8');
  assert.match(studio, /const startedAt = quoteRevisionNow\(\);\s*const saved = await custom\.saveNow\(\);/);
  assert.match(studio, /\}, startedAt\);/);
  assert.match(studio, /setDescription\(''\);\s*setActiveTemplate\(null\);\s*clearQuote\(\);/);
  const preview = readFileSync(new URL('../app/veyrnox/_components/music/MusicCreateStudio.jsx', import.meta.url), 'utf8');
  assert.match(preview, /setDescription\(''\); setActiveTemplate\(null\);/);
});

test('the Create page ignores a template when a sample is present', () => {
  const source = readFileSync(new URL('../app/veyrnox/app/music/create/page.js', import.meta.url), 'utf8');
  assert.match(source, /sampleSeed \? null : licensedTemplateFor\(/);
});

test('the server studio consumes the stored draft without overriding a handoff', () => {
  const source = readFileSync(new URL('../app/veyrnox/_components/music/MusicServerStudio.jsx', import.meta.url), 'utf8');
  assert.match(source, /if \(!sampleSeed && !licensedTemplate && restored\) setDescription\(restored\);\s*sessionStorage\.removeItem\(MUSIC_PUBLIC_DRAFT_KEY\);/);
});
