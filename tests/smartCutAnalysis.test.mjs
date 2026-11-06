import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSpeechAwareCutPlan,
  normaliseScribeResult,
  normaliseWizperResult,
  parseSmartCutAnalysis,
  SMART_CUT_ANALYSIS_VERSION,
} from '../app/veyrnox/_lib/smartCutAnalysis.js';

const clip = { job_id: 'take-a', name: 'Opening take', duration: 10, in_s: 0, out_s: 10 };
const wizper = {
  text: 'Hello there. This is the second sentence.',
  languages: ['en'],
  chunks: [
    { timestamp: [0.5, 1.4], text: 'Hello there.' },
    { timestamp: [3, 4.4], text: 'This is the second sentence.' },
  ],
};

test('Wizper chunks normalize into the versioned provider-neutral contract', () => {
  const result = normaliseWizperResult({ assetId: clip.job_id, duration: clip.duration, result: wizper });
  assert.equal(result.ok, true);
  assert.equal(result.analysis.version, SMART_CUT_ANALYSIS_VERSION);
  assert.equal(result.analysis.provider, 'fal-wizper');
  assert.equal(result.analysis.language, 'en');
  assert.deepEqual(result.analysis.chunks.map(({ start, end }) => [start, end]), [[0.5, 1.4], [3, 4.4]]);
});

test('Scribe normalization keeps timed words and ignores spacing or audio events', () => {
  const result = normaliseScribeResult({
    assetId: clip.job_id,
    duration: clip.duration,
    result: {
      text: 'Hello world',
      language_code: 'eng',
      words: [
        { type: 'word', start: 0.1, end: 0.4, text: 'Hello' },
        { type: 'spacing', text: ' ' },
        { type: 'audio_event', start: 0.4, end: 0.7, text: '(music)' },
        { type: 'word', start: 0.7, end: 1.1, text: 'world' },
      ],
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.analysis.chunks.map((word) => word.text), ['Hello', 'world']);
});

test('Scribe normalization reports an explicit no-speech result for a valid silent response', () => {
  const result = normaliseScribeResult({
    assetId: clip.job_id,
    duration: 4,
    result: { text: '', language_code: null, language_probability: 0, words: [] },
  });
  assert.deepEqual(result, { ok: false, error: 'analysis_no_speech' });
});

test('Scribe word gaps from the paid probe become reviewable silence cuts', () => {
  const probedClip = { job_id: 'scribe-probe', name: 'Scribe pause fixture', duration: 5.4, in_s: 0, out_s: 5.4 };
  const normalized = normaliseScribeResult({
    assetId: probedClip.job_id,
    duration: probedClip.duration,
    result: {
      text: 'Hello world This is a pause test',
      language_code: 'eng',
      words: [
        { type: 'word', start: 0.08, end: 0.38, text: 'Hello' },
        { type: 'word', start: 0.42, end: 0.74, text: 'world' },
        { type: 'word', start: 2.54, end: 2.82, text: 'This' },
        { type: 'word', start: 2.86, end: 3.02, text: 'is' },
        { type: 'word', start: 3.06, end: 3.14, text: 'a' },
        { type: 'word', start: 3.18, end: 3.54, text: 'pause' },
        { type: 'word', start: 3.58, end: 3.88, text: 'test' },
      ],
    },
  });
  assert.equal(normalized.ok, true);
  const plan = buildSpeechAwareCutPlan({ clips: [probedClip], analyses: { [probedClip.job_id]: normalized.analysis } });
  assert.equal(plan.analysisProviders[0], 'fal-scribe-v2');
  assert.deepEqual(plan.segments.map(({ start, end }) => [start, end]), [[0, 0.86], [2.42, 4]]);
  assert.equal(plan.silenceRemoved, 2.96);
});

test('analysis rejects mismatched assets, durations, unsupported providers and out-of-range timestamps', () => {
  const base = {
    version: 1,
    assetId: clip.job_id,
    duration: clip.duration,
    provider: 'fal-wizper',
    transcript: 'Hello',
    language: 'en',
    chunks: [{ start: 0.2, end: 0.8, text: 'Hello' }],
  };
  assert.equal(parseSmartCutAnalysis(base, { assetId: 'another', duration: 10 }).error, 'analysis_asset_mismatch');
  assert.equal(parseSmartCutAnalysis(base, { assetId: clip.job_id, duration: 9 }).error, 'analysis_duration_mismatch');
  assert.equal(parseSmartCutAnalysis({ ...base, provider: 'unknown' }).error, 'analysis_provider_invalid');
  assert.equal(parseSmartCutAnalysis({ ...base, chunks: [{ start: 9.8, end: 10.5, text: 'late' }] }).error, 'analysis_timestamp_invalid');
  assert.equal(normaliseWizperResult({ assetId: clip.job_id, duration: 10, result: { text: 'tail', chunks: [{ timestamp: [9, null], text: 'tail' }] } }).error, 'analysis_timestamp_invalid', 'incomplete provider timing fails closed instead of silently dropping speech');
});

test('speech-aware planning removes long pauses while keeping padded transcript ranges', () => {
  const normalized = normaliseWizperResult({ assetId: clip.job_id, duration: clip.duration, result: wizper }).analysis;
  const plan = buildSpeechAwareCutPlan({ clips: [clip], analyses: { [clip.job_id]: normalized } });
  assert.equal(plan.mode, 'transcript-silence');
  assert.equal(plan.segments.length, 2);
  assert.deepEqual(plan.segments.map(({ start, end }) => [start, end]), [[0.38, 1.52], [2.88, 4.52]]);
  assert.equal(plan.totalDuration, 2.78);
  assert.equal(plan.silenceRemoved, 7.22);
  assert.ok(plan.segments.every((segment) => segment.alternates.length === 0));
});

test('speech-aware planning respects pre-existing trim windows', () => {
  const trimmed = { ...clip, in_s: 1, out_s: 3.5 };
  const normalized = normaliseWizperResult({ assetId: clip.job_id, duration: clip.duration, result: wizper }).analysis;
  const plan = buildSpeechAwareCutPlan({ clips: [trimmed], analyses: { [clip.job_id]: normalized } });
  assert.ok(plan.segments.every((segment) => segment.start >= 1 && segment.end <= 3.5));
});

test('speech-aware planning rounds fractional trim starts inward', () => {
  const trimmed = { ...clip, in_s: 1.005, out_s: 3.5 };
  const normalized = normaliseWizperResult({ assetId: clip.job_id, duration: clip.duration, result: wizper }).analysis;
  const plan = buildSpeechAwareCutPlan({ clips: [trimmed], analyses: { [clip.job_id]: normalized } });
  assert.ok(plan.segments[0].start >= trimmed.in_s);
  assert.ok(plan.segments.every((segment) => segment.end <= trimmed.out_s));
  assert.ok(plan.totalDuration <= 60);
});

test('speech-aware planning treats duplicate editor rows as separate source windows', () => {
  const normalized = normaliseWizperResult({ assetId: clip.job_id, duration: clip.duration, result: wizper }).analysis;
  const rows = [
    { ...clip, uid: 'take-a#one', in_s: 0, out_s: 2 },
    { ...clip, uid: 'take-a#two', in_s: 2, out_s: 5 },
  ];
  const plan = buildSpeechAwareCutPlan({ clips: rows, analyses: { [clip.job_id]: normalized } });
  assert.deepEqual(plan.takes.map((take) => take.id), ['take-a#one', 'take-a#two']);
  assert.deepEqual(plan.segments.map((segment) => segment.takeId), ['take-a#one', 'take-a#two']);
  assert.equal(plan.segments.every((segment) => segment.start >= rows.find((row) => row.uid === segment.takeId).in_s), true);
});

test('many transcript groups merge shortest pauses to fit ten renderer sections', () => {
  const duration = 40;
  const many = Array.from({ length: 14 }, (_, index) => ({ timestamp: [index * 2.5, index * 2.5 + 0.5], text: `Word ${index + 1}` }));
  const normalized = normaliseWizperResult({ assetId: 'long', duration, result: { text: 'many', languages: ['en'], chunks: many } }).analysis;
  const plan = buildSpeechAwareCutPlan({ clips: [{ job_id: 'long', duration }], analyses: { long: normalized } });
  assert.equal(plan.segments.length, 10);
  assert.ok(plan.warnings.some((warning) => /10-section/i.test(warning)));
});

test('speech-aware planning refuses more source clips than the renderer can represent', () => {
  const manyClips = Array.from({ length: 11 }, (_, index) => ({ job_id: `take-${index}`, duration: 2 }));
  const analyses = Object.fromEntries(manyClips.map((item) => [item.job_id, {
    version: 1,
    assetId: item.job_id,
    duration: 2,
    provider: 'fal-wizper',
    transcript: 'Hello',
    language: 'en',
    chunks: [{ start: 0.2, end: 1, text: 'Hello' }],
  }]));
  assert.throws(() => buildSpeechAwareCutPlan({ clips: manyClips, analyses }), /at most 10 source clips/);
});

test('speech-aware planning stops at sixty seconds without extending past source', () => {
  const duration = 90;
  const normalized = normaliseWizperResult({
    assetId: 'long',
    duration,
    result: { text: 'continuous speech', languages: ['en'], chunks: [{ timestamp: [0, 80], text: 'continuous speech' }] },
  }).analysis;
  const plan = buildSpeechAwareCutPlan({ clips: [{ job_id: 'long', duration }], analyses: { long: normalized } });
  assert.equal(plan.totalDuration, 60);
  assert.equal(plan.segments[0].end, 60);
  assert.ok(plan.warnings.some((warning) => /60-second/i.test(warning)));
});

test('missing analysis and speech-free ranges fail before a plan is produced', () => {
  assert.throws(() => buildSpeechAwareCutPlan({ clips: [clip], analyses: {} }), /unavailable or invalid/);
  const normalized = normaliseWizperResult({ assetId: clip.job_id, duration: clip.duration, result: wizper }).analysis;
  assert.throws(() => buildSpeechAwareCutPlan({ clips: [{ ...clip, in_s: 7, out_s: 9 }], analyses: { [clip.job_id]: normalized } }), /No timed speech/);
});
