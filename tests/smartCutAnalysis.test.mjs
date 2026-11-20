import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSpeechAwareCutPlan,
  normaliseScribeResult,
  normaliseWizperResult,
  parseSmartCutAnalysis,
  SMART_CUT_ANALYSIS_VERSION,
  SMART_CUT_SILENCE_DEFAULTS,
  SMART_CUT_SILENCE_PRESETS,
  smartCutSilencePreset,
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

const pacedWords = {
  language_code: 'eng',
  text: 'one two three four',
  words: [
    { type: 'word', text: 'one', start: 0.5, end: 1.0 },
    { type: 'word', text: 'two', start: 1.6, end: 2.0 },
    { type: 'word', text: 'three', start: 3.0, end: 3.5 },
    { type: 'word', text: 'four', start: 5.0, end: 5.5 },
  ],
};

test('silence presets: natural equals the long-standing defaults and balanced is its alias', () => {
  assert.deepEqual(SMART_CUT_SILENCE_PRESETS.natural, SMART_CUT_SILENCE_DEFAULTS);
  assert.equal(smartCutSilencePreset('balanced'), 'natural');
  assert.equal(smartCutSilencePreset('snappy'), 'snappy');
  assert.equal(smartCutSilencePreset('nonsense'), 'natural');
  assert.equal(smartCutSilencePreset(undefined), 'natural');
});

test('snappy cuts more pauses than natural, relaxed keeps more, and the plan records the preset', () => {
  const analysis = normaliseScribeResult({ assetId: clip.job_id, duration: clip.duration, result: pacedWords }).analysis;
  const plan = (silencePreset) => buildSpeechAwareCutPlan({ clips: [clip], analyses: { [clip.job_id]: analysis }, silencePreset });
  const snappy = plan('snappy');
  const natural = plan(undefined);
  const relaxed = plan('relaxed');
  assert.equal(snappy.silencePreset, 'snappy');
  assert.equal(natural.silencePreset, 'natural');
  assert.equal(relaxed.silencePreset, 'relaxed');
  assert.ok(snappy.segments.length > natural.segments.length);
  assert.ok(natural.segments.length > relaxed.segments.length);
  assert.ok(snappy.silenceRemoved > natural.silenceRemoved);
  assert.ok(natural.silenceRemoved > relaxed.silenceRemoved);
  assert.deepEqual(plan('balanced').segments, natural.segments);
});

test('explicit silence numbers still override a preset', () => {
  const analysis = normaliseScribeResult({ assetId: clip.job_id, duration: clip.duration, result: pacedWords }).analysis;
  const base = { clips: [clip], analyses: { [clip.job_id]: analysis } };
  assert.deepEqual(
    buildSpeechAwareCutPlan({ ...base, silencePreset: 'relaxed', minimumSilenceSeconds: 0.4, edgePaddingSeconds: 0.08 }).segments,
    buildSpeechAwareCutPlan({ ...base, silencePreset: 'snappy' }).segments,
  );
});

test('timing quality follows the provider and phrase-level timing adds a plan warning', () => {
  const word = normaliseScribeResult({ assetId: clip.job_id, duration: clip.duration, result: pacedWords });
  const phrase = normaliseWizperResult({ assetId: clip.job_id, duration: clip.duration, result: wizper });
  assert.equal(word.analysis.timingQuality, 'word');
  assert.equal(phrase.analysis.timingQuality, 'phrase');
  const wordPlan = buildSpeechAwareCutPlan({ clips: [clip], analyses: { [clip.job_id]: word.analysis } });
  const phrasePlan = buildSpeechAwareCutPlan({ clips: [clip], analyses: { [clip.job_id]: phrase.analysis } });
  assert.ok(!wordPlan.warnings.some((w) => /phrase-level/.test(w)));
  assert.ok(phrasePlan.warnings.some((w) => /phrase-level/.test(w)));
  // A stored v1 record without the field is still accepted and gets its quality from the provider.
  const { timingQuality, ...stored } = word.analysis;
  assert.equal(parseSmartCutAnalysis(stored, { assetId: clip.job_id }).analysis.timingQuality, 'word');
});

const fillerWords = {
  language_code: 'eng',
  text: 'so um we go',
  words: [
    { type: 'word', text: 'so', start: 0.5, end: 0.8 },
    { type: 'word', text: 'um', start: 1.0, end: 1.3 },
    { type: 'word', text: 'we', start: 1.4, end: 1.7 },
    { type: 'word', text: 'go', start: 1.8, end: 2.1 },
  ],
};

test('reviewed removals cut a filler out of the middle of a section and keep both halves', () => {
  const analysis = normaliseScribeResult({ assetId: clip.job_id, duration: clip.duration, result: fillerWords }).analysis;
  const base = { clips: [clip], analyses: { [clip.job_id]: analysis } };
  const without = buildSpeechAwareCutPlan(base);
  assert.equal(without.segments.length, 1);
  const withRemoval = buildSpeechAwareCutPlan({ ...base, removals: [{ takeId: clip.job_id, start: 0.97, end: 1.33 }] });
  assert.equal(withRemoval.segments.length, 2);
  assert.ok(withRemoval.segments[0].end <= 0.97 && withRemoval.segments[1].start >= 1.33);
  assert.ok(withRemoval.totalDuration < without.totalDuration);
  assert.equal(withRemoval.removalsApplied, 1);
  assert.deepEqual(without.warnings, withRemoval.warnings);
});

test('a standalone filler between long pauses disappears and malformed removals are ignored', () => {
  const alone = normaliseScribeResult({ assetId: clip.job_id, duration: clip.duration, result: {
    language_code: 'eng', text: 'hello um goodbye',
    words: [
      { type: 'word', text: 'hello', start: 0.5, end: 0.9 },
      { type: 'word', text: 'um', start: 2.5, end: 2.8 },
      { type: 'word', text: 'goodbye', start: 5.0, end: 5.5 },
    ] } }).analysis;
  const base = { clips: [clip], analyses: { [clip.job_id]: alone } };
  assert.equal(buildSpeechAwareCutPlan(base).segments.length, 3);
  const removed = buildSpeechAwareCutPlan({ ...base, removals: [{ takeId: clip.job_id, start: 2.47, end: 2.83 }] });
  assert.equal(removed.segments.length, 2);
  const ignored = buildSpeechAwareCutPlan({ ...base, removals: [null, { takeId: 5, start: 1, end: 2 }, { takeId: clip.job_id, start: 3, end: 2 }, { takeId: 'other-take', start: 2.4, end: 2.9 }] });
  assert.deepEqual(ignored.segments, buildSpeechAwareCutPlan(base).segments);
  assert.equal(ignored.removalsApplied, 0);
});

test('a removal the ten-section limit merges back is reported, not hidden', () => {
  const words = [
    { type: 'word', text: 'hello', start: 0, end: 1 },
    { type: 'word', text: 'um', start: 1.05, end: 1.35 },
    { type: 'word', text: 'there', start: 1.4, end: 2 },
    ...Array.from({ length: 9 }, (_, i) => ({ type: 'word', text: `w${i}`, start: 5 + i * 5, end: 6 + i * 5 })),
  ];
  const analysis = normaliseScribeResult({ assetId: clip.job_id, duration: 60, result: { language_code: 'eng', text: 'many', words } }).analysis;
  const longClip = { ...clip, duration: 60, out_s: 60 };
  const base = { clips: [longClip], analyses: { [clip.job_id]: analysis } };
  assert.equal(buildSpeechAwareCutPlan(base).segments.length, 10);
  // Splitting the first section makes 11; the smallest gap is the one just made, so the limit rejoins it.
  const plan = buildSpeechAwareCutPlan({ ...base, removals: [{ takeId: clip.job_id, start: 1.02, end: 1.38 }] });
  assert.equal(plan.segments.length, 10);
  assert.equal(plan.removalsApplied, 0);
  assert.ok(plan.warnings.some((warning) => /limited to 10 sections/.test(warning)));
});

test('a music-only response (audio-event text and no words) is no speech, not an invalid analysis', () => {
  // Shape returned by fal Scribe v2 for 20 s of synthetic tones, probed 2026-11-20.
  const music = { text: '[tone]', language_code: 'sh', language_probability: 0.395, words: [] };
  assert.deepEqual(normaliseScribeResult({ assetId: clip.job_id, duration: 20, result: music }), { ok: false, error: 'analysis_no_speech' });
  // Spacing and audio-event entries are not words either.
  const events = { text: '(music)', language_code: 'en', words: [{ type: 'spacing', text: ' ', start: 0, end: 1 }, { type: 'audio_event', text: '(music)', start: 0, end: 5 }] };
  assert.deepEqual(normaliseScribeResult({ assetId: clip.job_id, duration: 20, result: events }), { ok: false, error: 'analysis_no_speech' });
  // A result with at least one real word is still an analysis.
  const speech = { text: 'hello', language_code: 'eng', words: [{ type: 'word', text: 'hello', start: 0.2, end: 0.6 }] };
  assert.equal(normaliseScribeResult({ assetId: clip.job_id, duration: 5, result: speech }).ok, true);
});

test('Japanese and Chinese punctuation tokens are dropped, so those clips parse', () => {
  // Shape fal Scribe v2 returned for synthetic Japanese and Chinese clips on 2026-11-20: one token per
  // character, with punctuation as zero-length "words" (and one comma token spanning a real pause).
  const ja = { text: 'こんにちは、デモ。', language_code: 'jpn', words: [
    { type: 'word', text: 'こ', start: 0.12, end: 0.22 }, { type: 'word', text: 'ん', start: 0.22, end: 0.38 },
    { type: 'word', text: '、', start: 1, end: 1 }, { type: 'word', text: 'デ', start: 1.2, end: 1.4 },
    { type: 'word', text: 'モ', start: 1.4, end: 1.6 }, { type: 'word', text: '。', start: 1.6, end: 1.6 },
  ] };
  const parsedJa = normaliseScribeResult({ assetId: clip.job_id, duration: 3, result: ja });
  assert.equal(parsedJa.ok, true);
  assert.deepEqual(parsedJa.analysis.chunks.map((c) => c.text), ['こ', 'ん', 'デ', 'モ']);
  const zh = { text: '你好，欢迎。', language_code: 'zho', words: [
    { type: 'word', text: '你', start: 0.04, end: 0.22 }, { type: 'word', text: '好', start: 0.22, end: 0.5 },
    { type: 'word', text: '，', start: 0.5, end: 0.88 }, { type: 'word', text: '欢', start: 0.9, end: 1.1 },
    { type: 'word', text: '。', start: 1.1, end: 1.1 },
  ] };
  const parsedZh = normaliseScribeResult({ assetId: clip.job_id, duration: 2, result: zh });
  assert.equal(parsedZh.ok, true);
  // The comma token no longer counts as speech, so the planner sees the real gap after "好".
  assert.deepEqual(parsedZh.analysis.chunks.map((c) => c.text), ['你', '好', '欢']);
  // A result that is only punctuation has no speech.
  const marks = { text: '。', language_code: 'jpn', words: [{ type: 'word', text: '。', start: 1, end: 1 }] };
  assert.deepEqual(normaliseScribeResult({ assetId: clip.job_id, duration: 3, result: marks }), { ok: false, error: 'analysis_no_speech' });
  // A real word with zero length is still rejected, not silently repaired.
  const zero = { text: 'hi', language_code: 'eng', words: [{ type: 'word', text: 'hi', start: 1, end: 1 }] };
  assert.equal(normaliseScribeResult({ assetId: clip.job_id, duration: 3, result: zero }).error, 'analysis_timestamp_invalid');
});
