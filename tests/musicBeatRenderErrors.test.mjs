import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beatErrorMessage } from '../app/veyrnox/_lib/music/beat/beatErrors.mjs';
import { exportSize } from '../app/veyrnox/_lib/music/beat/beatSequence.mjs';
import { planExport } from '../app/veyrnox/_lib/music/beat/beatExport.mjs';
import { translator } from '../lib/i18n/translate.mjs';
import { LOCALES } from '../lib/i18n/locales.mjs';

const ENGLISH = {
  'export-limit': 'Song export is limited to 600 seconds.',
  'too-much-audio': 'This song uses too much audio to export. Shorten it or remove some sounds.',
  'recovery-r51': 'This song is too long to export on this phone. Export a cycle range, or use a computer.',
  'sound-too-large': 'This sound uses too much audio to load in this browser (over 300 MB).',
  'song-too-large-browser': 'This song uses too much audio to export in this browser (about 692 MB). Shorten it or remove some sounds.',
  'cycle-off': 'Turn Cycle on to export a cycle range.',
  'invalid-range': 'Invalid song or cycle range.',
  'invalid-export-range': 'Invalid export range.',
  'take-deleted': 'This take was deleted',
};
const PARAMS = { mb: 692 };

test('known render limits keep their English wording through a stable code', () => {
  for (const [code, text] of Object.entries(ENGLISH)) assert.equal(beatErrorMessage({ displayCode: code, params: PARAMS }, 'render'), text);
  assert.equal(beatErrorMessage(new Error('Incomplete rendered mix.'), 'render'), "Couldn't render this mix. Try again.");
});

test('known render limits are translated in every locale and never fall back to the generic message', async () => {
  for (const { code } of LOCALES) {
    const messages = (await import(`../lib/i18n/messages/app/${code}.mjs`)).default;
    const t = translator(code, messages);
    for (const key of Object.keys(ENGLISH)) {
      const text = beatErrorMessage({ displayCode: key, params: PARAMS }, 'render', t);
      if (key === 'song-too-large-browser') assert.match(text, /692/, `${code}: the size is shown`);
      assert.doesNotMatch(text, /\{\w+\}/, `${code}: ${key} left a placeholder`);
      assert.notEqual(text, beatErrorMessage(new Error('x'), 'render', t), `${code}: ${key} fell back to the generic message`);
      if (code !== 'en') assert.notEqual(text, ENGLISH[key], `${code}: ${key} is still English`);
    }
  }
});

test('every known render-limit throw site carries its code', () => {
  const exp = readFileSync('app/veyrnox/_lib/music/beat/beatExport.mjs', 'utf8');
  const seq = readFileSync('app/veyrnox/_lib/music/beat/beatSequence.mjs', 'utf8');
  assert.equal((exp.match(/displayCode: 'recovery-r51'/g) || []).length, 1);
  assert.match(exp, /displayCode: phone \? 'recovery-r51' : 'too-much-audio'/);
  assert.match(seq, /BeatExportError\('Song export is limited to 600 seconds\.'\), \{ displayCode: 'export-limit' \}/);
  assert.equal(exportSize.length >= 1 && planExport.length >= 1, true);
  const rules = readFileSync('app/veyrnox/_lib/music/beat/beatAudioRules.mjs', 'utf8');
  const assets = readFileSync('app/veyrnox/_lib/music/beat/beatAssets.js', 'utf8');
  assert.match(assets, /code: 'take-deleted'/);
  assert.match(assets, /code: error\.displayCode, params: error\.params \}\)/);
  assert.match(readFileSync('app/veyrnox/_components/music/beat/BeatAudioRegion.jsx', 'utf8'), /displayCode: state\.code, params: state\.params/);
  assert.match(rules, /displayCode: 'sound-too-large'/);
  assert.match(rules, /displayCode: 'song-too-large-browser', params: \{ mb \}/);
  for (const code of ['invalid-range', 'invalid-export-range', 'cycle-off']) assert.match(seq, new RegExp(`displayCode: '${code}'`));
  const dialog = readFileSync('app/veyrnox/_components/music/beat/BeatExportDialog.jsx', 'utf8');
  assert.match(dialog, /e\.displayCode \? beatErrorMessage\(e, 'render', t\)/);
});

test('the export progress bar is driven by numbers, not by parsing translated text', () => {
  const dialog = readFileSync('app/veyrnox/_components/music/beat/BeatExportDialog.jsx', 'utf8');
  assert.doesNotMatch(dialog, /progress\.match|\(\\d\+\) of|Uploading \(/);
  assert.match(dialog, /status\(message, fraction\)/);
  assert.match(readFileSync('app/veyrnox/_lib/music/beat/beatMixdownSave.js', 'utf8'), /e\.loaded \/ e\.total\);/);
  assert.match(readFileSync('app/veyrnox/_lib/music/beat/beatMixdown.js', 'utf8'), /completed \/ ids\.length\);/);
});
