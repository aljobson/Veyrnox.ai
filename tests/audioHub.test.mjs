import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { LOCALES } from '../lib/i18n/locales.mjs';

const page = readFileSync('app/veyrnox/app/audio/page.js', 'utf8');
const studios = [...page.matchAll(/\{ id: '(\w+)', href: '([^']+)', modelIds:/g)].map((m) => ({ id: m[1], href: m[2] }));

test('the Audio hub lists only studios backed by a live catalog model', () => {
  assert.deepEqual(studios.map((s) => s.id), ['sounds', 'speech', 'dub']);
  assert.doesNotMatch(page, /id: 'music'|id: 'dialogue'/);
  assert.match(page, /studio\.modelIds\.some\(\(id\) => modelIds\.has\(id\)\)/);
  for (const { href } of studios) {
    const dir = `app/veyrnox${href}`;
    assert.ok(existsSync(`${dir}/page.js`), `${href} has a page`);
  }
});

test('every hub string exists in every locale', async () => {
  const ids = ['title', 'intro', ...studios.flatMap((s) => [`${s.id}.title`, `${s.id}.blurb`])];
  const codes = (Array.isArray(LOCALES) ? LOCALES : Object.keys(LOCALES)).map((l) => (typeof l === 'string' ? l : l.code));
  assert.ok(codes.length >= 11, 'all locales are covered');
  for (const code of codes) {
    const messages = (await import(`../lib/i18n/messages/app/${code}.mjs`)).default;
    for (const id of ids) assert.equal(typeof messages[`app.audio.${id}`], 'string', `${code} app.audio.${id}`);
  }
});
