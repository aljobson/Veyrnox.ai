import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(sourcePath, imports) {
  const source = readFileSync(new URL(sourcePath, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => imports[id] ?? {}, loaded, loaded.exports);
  return loaded.exports;
}

const web = load('../app/veyrnox/_components/music/MusicAdvancedDirectionFields.jsx', {
  react: { useState() {} },
  './MusicCreateIcon': { MusicCreateIcon() {} },
});

const mobile = load('../apps/mobile/src/components/music/MusicSmartDirectionControls.tsx', {
  react: { useState() {} },
  'react-native': {},
  '../../theme': { ds: { space: {}, radius: {} } },
  '../ui': { themedStyles: make => make({}) },
});

const EMPTY = { voice: '', genre: '', mood: '', tempo: '', structure: '' };
const CINEMATIC = { ...EMPTY, genre: 'Cinematic', mood: 'Uplifting' };

for (const [surface, canMerge, merge] of [
  ['web', web.canMergeMusicStyleDirection, web.mergeMusicStyleDirection],
  ['mobile', mobile.canMergeSmartDirectionText, mobile.mergeSmartDirectionText],
]) {
  test(`${surface} Smart Direction never truncates a full user field`, () => {
    const original = 'x'.repeat(96);
    assert.equal(canMerge(original, CINEMATIC, 100), false);
    assert.equal(merge(original, CINEMATIC, 100), original);
  });

  test(`${surface} Smart Direction appends, replaces and clears only its own suffix`, () => {
    const original = 'Warm drums and a wide chorus';
    const first = merge(original, CINEMATIC, 220);
    assert.equal(first, `${original}\n[Smart direction: Genre: Cinematic; Mood: Uplifting]`);
    const changed = merge(first, { ...CINEMATIC, mood: 'Triumphant' }, 220);
    assert.equal(changed, `${original}\n[Smart direction: Genre: Cinematic; Mood: Triumphant]`);
    assert.equal(merge(changed, EMPTY, 220), original);
  });
}

test('web and mobile only change vocal mode after an explicit Voice change', () => {
  const webSource = readFileSync(new URL('../app/veyrnox/_components/music/MusicServerStudio.jsx', import.meta.url), 'utf8');
  const mobileSource = readFileSync(new URL('../apps/mobile/src/app/(app)/music/create.tsx', import.meta.url), 'utf8');
  assert.match(webSource, /const voiceChanged = next\.voice !== direction\.voice;/);
  assert.match(webSource, /if \(voiceChanged\) \{[\s\S]*?updateControl\('instrumental'/);
  assert.match(mobileSource, /const voicePatch = !voiceChanged \? \{\}/);
});

test('the single-track billing and refund decision is recorded', () => {
  const adr = readFileSync(new URL('../docs/adr/0379-music-create-single-track.md', import.meta.url), 'utf8');
  assert.match(adr, /one catalog unit/);
  assert.match(adr, /4 Credits, not the former 8-Credit pair/);
  assert.match(adr, /one ledger debit/);
  assert.match(adr, /Historical two-output generations remain A\/B/);
});
