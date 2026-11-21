import assert from 'node:assert/strict';
import test from 'node:test';
import { SMART_CUT_FILLER_WORDS, smartCutFillerRanges } from '../app/veyrnox/_lib/smartCutFillers.js';
import { normaliseScribeResult, normaliseWizperResult } from '../app/veyrnox/_lib/smartCutAnalysis.js';

const assetId = 'take-a';
const scribe = (language_code, tokens, duration = 12) => normaliseScribeResult({
  assetId, duration, result: { language_code, text: tokens.map((t) => t[0]).join(' '),
    words: tokens.map(([text, start, end]) => ({ type: 'word', text, start, end })) },
}).analysis;

test('hesitation sounds become padded, review-only removals inside the gaps around them', () => {
  const analysis = scribe('eng', [['So', 0.5, 0.8], ['um,', 1.0, 1.3], ['we', 1.5, 1.7], ['uh', 2.0, 2.2], ['go', 2.25, 2.5]]);
  const ranges = smartCutFillerRanges(analysis);
  assert.deepEqual(ranges.map((r) => r.label), ['um,', 'uh']);
  assert.deepEqual(ranges[0], { start: 0.97, end: 1.33, label: 'um,' });
  // The padding never reaches the neighbouring word: "go" starts at 2.25.
  assert.ok(ranges[1].end <= 2.25 && ranges[1].start >= 1.7);
});

test('words that can carry meaning are never proposed', () => {
  const analysis = scribe('eng', [['I', 0.5, 0.6], ['like', 0.7, 0.9], ['so', 1.0, 1.1], ['well', 1.2, 1.4], ['you', 1.5, 1.6], ['know', 1.7, 1.9]]);
  assert.deepEqual(smartCutFillerRanges(analysis), []);
});

test('adjacent fillers merge into one removal', () => {
  const analysis = scribe('eng', [['Hello', 0.5, 0.9], ['um', 1.0, 1.2], ['uh', 1.22, 1.4], ['there', 1.6, 1.9]]);
  const ranges = smartCutFillerRanges(analysis);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].label, 'um uh');
});

test('phrase-level, unknown and unsupported-language records propose nothing', () => {
  const phrase = normaliseWizperResult({ assetId, duration: 10, result: { text: 'um hello', languages: ['en'], chunks: [{ timestamp: [0.5, 1.4], text: 'um hello' }] } }).analysis;
  assert.equal(phrase.timingQuality, 'phrase');
  assert.deepEqual(smartCutFillerRanges(phrase), []);
  assert.deepEqual(smartCutFillerRanges(scribe('xxx', [['um', 1, 1.2]])), []); // language und
  assert.deepEqual(smartCutFillerRanges(scribe('zho', [['um', 1, 1.2]])), []); // no reliable lexicon
  assert.deepEqual(smartCutFillerRanges(null), []);
});

test('other supported languages match their own hesitation spellings', () => {
  assert.equal(smartCutFillerRanges(scribe('deu', [['Also', 0.5, 0.8], ['ähm', 1.0, 1.3], ['gut', 1.5, 1.8]])).length, 1);
  assert.equal(smartCutFillerRanges(scribe('fra', [['Alors', 0.5, 0.8], ['euh', 1.0, 1.3], ['oui', 1.5, 1.8]])).length, 1);
  assert.equal(smartCutFillerRanges(scribe('rus', [['Ну', 0.5, 0.8], ['эм', 1.0, 1.3], ['да', 1.5, 1.8]])).length, 1);
  assert.deepEqual(smartCutFillerRanges(scribe('eng', [['ähm', 1.0, 1.3]])), []); // lexicons are per language
});

test('lexicon stays hesitation-only and lowercase', () => {
  for (const [language, list] of Object.entries(SMART_CUT_FILLER_WORDS)) {
    for (const word of list) assert.equal(word, word.toLocaleLowerCase(language));
  }
  assert.ok(!SMART_CUT_FILLER_WORDS.en.includes('like'));
  assert.ok(!SMART_CUT_FILLER_WORDS.en.includes('so'));
});

test('selected range is filtered and clamped before the suggestion cap', () => {
  const early = Array.from({ length: 51 }, (_, index) => ['um', index * 0.5, index * 0.5 + 0.1]);
  const analysis = scribe('eng', [...early, ['um', 55, 55.2]], 60);
  assert.equal(smartCutFillerRanges(analysis).length, 50);
  assert.deepEqual(smartCutFillerRanges(analysis, { start: 54, end: 56 }), [{ start: 54.97, end: 55.23, label: 'um' }]);
});
