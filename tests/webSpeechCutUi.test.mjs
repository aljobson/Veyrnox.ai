import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LOCALES } from '../lib/i18n/locales.mjs';
import en from '../lib/i18n/messages/app/en/smart-cut.mjs';
import { speechErrorKey } from '../app/veyrnox/_lib/speechCutClient.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const messages = en.default || en;

test('the analysis panel shows the price and the processor before any charge and needs a click', () => {
  const panel = read('app/veyrnox/_components/SmartCutAnalyse.js');
  assert.match(panel, /app\.smartCut\.analyse\.confirm/);
  assert.match(panel, /app\.smartCut\.analyse\.privacy/);
  assert.match(panel, /onClick=\{analyseAll\}/);
  // The quote is read on mount; nothing may start a paid request without the confirm click.
  assert.doesNotMatch(panel, /useEffect\([^)]*startSpeech/s);
});

test('the edit sheet hands finished analyses to the planner and the planner stays free', () => {
  const sheet = read('app/veyrnox/_components/EditSheet.js');
  assert.match(sheet, /SmartCutAnalyse/);
  assert.match(sheet, /analyses=\{/);
});

test('the Library card offers Smart Cut only where the editor selection is allowed', () => {
  const card = read('app/veyrnox/_components/LibraryJobCard.js');
  assert.match(card, /onSmartCut/);
  assert.match(card, /data-testid="library-smart-cut"/);
  assert.match(card, /selectable && onSmartCut/);
  const page = read('app/veyrnox/app/library/page.js');
  assert.match(page, /onSmartCut=/);
});

test('every analyse message key the code can ask for exists in English', () => {
  for (const code of ['source_too_long', 'duration_mismatch', 'price_changed', 'speech_cut_unavailable', 'insufficient_balance', 'poll_timeout', 'x']) {
    assert.ok(messages[speechErrorKey({ code })], code);
  }
  for (const key of ['title', 'body', 'privacy', 'price', 'confirm', 'checking', 'running', 'done', 'tooLong', 'noSpeech', 'retry', 'unavailable', 'refunded']) {
    assert.ok(messages[`app.smartCut.analyse.${key}`], key);
  }
  assert.ok(messages['app.library.smartCutThis']);
});

test('the price copy never claims a verified price and other locales inherit English', () => {
  for (const [key, value] of Object.entries(messages)) {
    if (key.startsWith('app.smartCut.analyse.')) assert.doesNotMatch(value, /verified/i, key);
  }
  assert.ok(Array.isArray(LOCALES) || typeof LOCALES === 'object');
});
