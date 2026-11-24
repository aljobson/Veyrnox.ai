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
  swapSpeechAwareCutTake,
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

test('automatic language metadata is preserved and a matching override can recover unknown-language script alignment', () => {
  const analysis = {
    version: 1, assetId: 'a', duration: 3, provider: 'fal-scribe-v2', transcript: '今日は晴れです。', language: 'xxx',
    chunks: [
      { start: 0.4, end: 0.7, text: '今日' },
      { start: 0.8, end: 1.1, text: 'は' },
      { start: 1.2, end: 1.5, text: '晴れ' },
      { start: 1.6, end: 1.9, text: 'です。' },
    ],
  };
  const input = { clips: [{ job_id: 'a', duration: 3 }], analyses: { a: analysis }, script: '今日は晴れです。' };
  assert.throws(() => buildSpeechAwareCutPlan(input), (error) => error?.code === 'script_match_missing');
  const plan = buildSpeechAwareCutPlan({ ...input, languageOverride: 'ja' });
  assert.equal(plan.language, 'ja');
  assert.equal(plan.languageOverride, 'ja');
  assert.deepEqual(plan.detectedLanguages, ['und']);
  assert.equal(plan.segments[0].matchCode, 'script_line_matched');
  assert.ok(!plan.warningDetails.some((warning) => warning.code === 'language_unknown'));
  assert.throws(() => buildSpeechAwareCutPlan({ ...input, languageOverride: 'xx' }), (error) => error?.code === 'language_override_invalid');
});

test('automatic mode reports mixed languages and does not cluster identical cross-language takes', () => {
  const chunks = [
    { start: 0.5, end: 0.8, text: 'Same' },
    { start: 0.9, end: 1.2, text: 'complete' },
    { start: 1.3, end: 1.6, text: 'line.' },
  ];
  const make = (assetId, language) => ({ version: 1, assetId, duration: 3, provider: 'fal-scribe-v2', transcript: 'Same complete line.', language, chunks });
  const plan = buildSpeechAwareCutPlan({
    clips: [{ job_id: 'english', duration: 3 }, { job_id: 'spanish', duration: 3 }],
    analyses: { english: make('english', 'en'), spanish: make('spanish', 'es') },
  });
  assert.equal(plan.language, 'und');
  assert.deepEqual(plan.detectedLanguages, ['en', 'es']);
  assert.equal(plan.segments.length, 2);
  assert.ok(plan.warningDetails.some((warning) => warning.code === 'language_mixed'));
  assert.ok(!plan.warningDetails.some((warning) => warning.code === 'retake_omitted'));
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

test('large padding stops at adjacent-word midpoints instead of overlapping the next phrase', () => {
  const analysis = {
    version: 1, assetId: 'a', duration: 3, provider: 'fal-scribe-v2', transcript: 'First Second', language: 'en',
    chunks: [
      { start: 0.5, end: 0.8, text: 'First' },
      { start: 1.2, end: 1.5, text: 'Second' },
    ],
  };
  const plan = buildSpeechAwareCutPlan({
    clips: [{ job_id: 'a', duration: 3 }],
    analyses: { a: analysis },
    minimumSilenceSeconds: 0.3,
    edgePaddingSeconds: 0.5,
  });
  assert.equal(plan.segments.length, 2);
  assert.ok(plan.segments[0].end <= 1);
  assert.ok(plan.segments[1].start >= 1);
  assert.ok(plan.qualityChecks.filter((check) => check.code === 'complete_unit_boundaries').length === 2);
  assert.ok(!plan.qualityChecks.some((check) => check.code === 'clipped_timed_unit'));
});

test('speech-aware planning aligns supplied script lines and preserves notes', () => {
  const normalized = normaliseWizperResult({ assetId: clip.job_id, duration: clip.duration, result: wizper }).analysis;
  const plan = buildSpeechAwareCutPlan({ clips: [clip], analyses: { [clip.job_id]: normalized }, script: '  Hello there.\nThis is the second sentence.  ', notes: '  Prefer the opening.  ' });
  assert.equal(plan.scriptProvided, true);
  assert.equal(plan.notes, 'Prefer the opening.');
  assert.deepEqual(plan.segments.map((segment) => segment.matchCode), ['script_line_matched', 'script_line_matched']);
  assert.ok(plan.segments.every((segment) => segment.matchParameters.confidence === 1));
  assert.ok(!plan.warningDetails.some((warning) => warning.code === 'script_not_aligned'));
});

test('script alignment ranks cleaner takes, keeps deterministic alternates and explains the score', () => {
  const clips = [
    { job_id: 'paused', name: 'Paused take', duration: 5 },
    { job_id: 'clean', name: 'Clean take', duration: 5 },
  ];
  const make = (assetId, chunks) => ({ version: 1, assetId, duration: 5, provider: 'fal-scribe-v2', transcript: 'Ship today.', language: 'en', chunks });
  const plan = buildSpeechAwareCutPlan({ clips, analyses: {
    paused: make('paused', [{ start: .5, end: .7, text: 'Ship' }, { start: 1.1, end: 1.3, text: 'today.' }]),
    clean: make('clean', [{ start: .5, end: .7, text: 'Ship' }, { start: .75, end: .95, text: 'today.' }]),
  }, script: 'Ship today.' });
  assert.equal(plan.segments[0].takeId, 'clean');
  assert.deepEqual(plan.segments[0].alternates, ['paused']);
  assert.equal(plan.segments[0].reasonCode, 'best_take_score');
  assert.equal(plan.segments[0].matchParameters.confidence, 1);
  const swapped = swapSpeechAwareCutTake(plan, plan.segments[0].id, 'paused');
  assert.equal(swapped.segments[0].takeId, 'paused');
  assert.equal(swapped.segments[0].reasonParameters.manual, true);
  assert.deepEqual(swapped.segments[0].alternates, ['clean']);
});

test('script alignment handles paraphrase, repeated lines, missing lines and unrelated speech', () => {
  const clips = [
    { job_id: 'a', name: 'Take A', duration: 8 },
    { job_id: 'b', name: 'Take B', duration: 8 },
  ];
  const analysis = (assetId, chunks) => ({ version: 1, assetId, duration: 8, provider: 'fal-scribe-v2', transcript: chunks.map((chunk) => chunk.text).join(' '), language: 'en', chunks });
  const plan = buildSpeechAwareCutPlan({ clips, analyses: {
    a: analysis('a', [{ start: .5, end: .8, text: 'Launch' }, { start: .9, end: 1.2, text: 'product' }, { start: 1.3, end: 1.6, text: 'today.' }, { start: 4, end: 4.4, text: 'Unrelated' }, { start: 4.5, end: 4.9, text: 'aside.' }]),
    b: analysis('b', [{ start: .5, end: .8, text: 'Launch' }, { start: .9, end: 1.2, text: 'product' }, { start: 1.3, end: 1.6, text: 'today.' }]),
  }, script: 'Launch the product today.\nLaunch product today.\nA missing closing line.' });
  assert.equal(plan.segments.length, 2);
  assert.deepEqual(new Set(plan.segments.map((segment) => segment.takeId)), new Set(['a', 'b']));
  assert.ok(plan.segments.every((segment) => segment.matchCode === 'script_line_matched'));
  assert.deepEqual(plan.warningDetails.find((warning) => warning.code === 'script_incomplete')?.parameters.lineNumbers, [3]);
  assert.equal(plan.warningDetails.find((warning) => warning.code === 'extra_speech_omitted')?.parameters.count, 1);
  assert.ok(plan.qualityChecks.some((check) => check.code === 'source_ranges_non_overlapping'));
  assert.ok(plan.qualityChecks.some((check) => check.code === 'join_review'));
});

test('false starts are removed separately while an isolated filler remains review-only', () => {
  const analysis = {
    version: 1, assetId: 'a', duration: 8, provider: 'fal-scribe-v2', transcript: 'so today so today we cook. um', language: 'en',
    chunks: [
      { start: .5, end: .8, text: 'so' }, { start: .9, end: 1.2, text: 'today' },
      { start: 3, end: 3.3, text: 'so' }, { start: 3.4, end: 3.7, text: 'today' }, { start: 3.8, end: 4.1, text: 'we' }, { start: 4.2, end: 4.5, text: 'cook.' },
      { start: 6, end: 6.2, text: 'um' },
    ],
  };
  const plan = buildSpeechAwareCutPlan({ clips: [{ job_id: 'a', duration: 8 }], analyses: { a: analysis } });
  assert.ok(!plan.segments.some((segment) => segment.label === 'so today'));
  assert.ok(plan.segments.some((segment) => segment.label === 'so today we cook.'));
  assert.ok(plan.segments.some((segment) => segment.label === 'um'));
  assert.equal(plan.warningDetails.find((warning) => warning.code === 'false_start_omitted')?.parameters.count, 1);
});

test('without a script, a repeated full take in one clip keeps only the later attempt', () => {
  const analysis = {
    version: 1, assetId: 'a', duration: 8, provider: 'fal-scribe-v2', transcript: 'Thanks for watching. Thanks for watching.', language: 'en',
    chunks: [
      { start: .5, end: .8, text: 'Thanks' }, { start: .9, end: 1.2, text: 'for' }, { start: 1.3, end: 1.6, text: 'watching.' },
      { start: 3, end: 3.3, text: 'Thanks' }, { start: 3.4, end: 3.7, text: 'for' }, { start: 3.8, end: 4.1, text: 'watching.' },
    ],
  };
  const plan = buildSpeechAwareCutPlan({ clips: [{ job_id: 'a', duration: 8 }], analyses: { a: analysis } });
  assert.equal(plan.segments.length, 1);
  assert.ok(plan.segments[0].start >= 2.88);
  assert.equal(plan.warningDetails.find((warning) => warning.code === 'retake_omitted')?.parameters.count, 1);
});

test('without a script, repeated takes across clips keep the later clip and expose the earlier alternate', () => {
  const chunks = [{ start: .5, end: .8, text: 'Thanks' }, { start: .9, end: 1.2, text: 'for' }, { start: 1.3, end: 1.6, text: 'watching.' }];
  const make = (assetId) => ({ version: 1, assetId, duration: 4, provider: 'fal-scribe-v2', transcript: 'Thanks for watching.', language: 'en', chunks });
  const plan = buildSpeechAwareCutPlan({
    clips: [{ job_id: 'first', duration: 4 }, { job_id: 'second', duration: 4 }],
    analyses: { first: make('first'), second: make('second') },
  });
  assert.equal(plan.segments.length, 1);
  assert.equal(plan.segments[0].takeId, 'second');
  assert.deepEqual(plan.segments[0].alternates, ['first']);
  assert.equal(plan.segments[0].reasonCode, 'best_take_score');
});

test('without a script, short phrases with different final words are not treated as retakes', () => {
  const chunks = (last) => [{ start: .5, end: .8, text: 'Thanks' }, { start: .9, end: 1.2, text: 'for' }, { start: 1.3, end: 1.6, text: last }];
  const make = (assetId, last) => ({ version: 1, assetId, duration: 4, provider: 'fal-scribe-v2', transcript: `Thanks for ${last}`, language: 'en', chunks: chunks(last) });
  const plan = buildSpeechAwareCutPlan({
    clips: [{ job_id: 'watching', duration: 4 }, { job_id: 'coming', duration: 4 }],
    analyses: { watching: make('watching', 'watching.'), coming: make('coming', 'coming.') },
  });
  assert.equal(plan.segments.length, 2);
  assert.ok(!plan.warningDetails.some((warning) => warning.code === 'retake_omitted'));
});

test('equal best-take scores resolve deterministically to the later selected take', () => {
  const chunks = [{ start: .5, end: .8, text: 'Same' }, { start: .9, end: 1.2, text: 'line.' }];
  const make = (assetId) => ({ version: 1, assetId, duration: 3, provider: 'fal-scribe-v2', transcript: 'Same line.', language: 'en', chunks });
  const plan = buildSpeechAwareCutPlan({
    clips: [{ job_id: 'first', duration: 3 }, { job_id: 'second', duration: 3 }],
    analyses: { first: make('first'), second: make('second') },
    script: 'Same line.',
  });
  assert.equal(plan.segments[0].takeId, 'second');
  assert.deepEqual(plan.segments[0].alternates, ['first']);
  assert.ok(!plan.warningDetails.some((warning) => warning.code === 'retake_omitted'));
});

test('a script with no transcript match returns an actionable structured error', () => {
  const analysis = { version: 1, assetId: 'a', duration: 3, provider: 'fal-scribe-v2', transcript: 'Hello there.', language: 'en', chunks: [{ start: .5, end: .8, text: 'Hello' }, { start: .9, end: 1.2, text: 'there.' }] };
  assert.throws(
    () => buildSpeechAwareCutPlan({ clips: [{ job_id: 'a', duration: 3 }], analyses: { a: analysis }, script: 'Completely different wording.' }),
    (error) => error?.code === 'script_match_missing' && error?.parameters?.lineNumbers?.[0] === 1,
  );
});

test('speech-aware planning does not restore partial units at both trim boundaries', () => {
  const trimmed = { ...clip, in_s: 1, out_s: 3.5 };
  const normalized = normaliseWizperResult({ assetId: clip.job_id, duration: clip.duration, result: wizper }).analysis;
  assert.throws(
    () => buildSpeechAwareCutPlan({ clips: [trimmed], analyses: { [clip.job_id]: normalized } }),
    (error) => error?.code === 'trim_intersects_unit' && error?.parameters?.reason === 'trim_intersects_all_units',
  );
});

test('speech-aware planning rejects a fractional trim window containing only partial units', () => {
  const trimmed = { ...clip, in_s: 1.005, out_s: 3.5 };
  const normalized = normaliseWizperResult({ assetId: clip.job_id, duration: clip.duration, result: wizper }).analysis;
  assert.throws(
    () => buildSpeechAwareCutPlan({ clips: [trimmed], analyses: { [clip.job_id]: normalized } }),
    (error) => error?.code === 'trim_intersects_unit' && error?.parameters?.units?.length === 2,
  );
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
  assert.ok(plan.warningDetails.some((warning) => warning.code === 'segment_limit_reached'));
});

test('more than ten groups across three takes merge without losing speech', () => {
  const manyClips = Array.from({ length: 3 }, (_, index) => ({ job_id: `take-${index}`, duration: 10 }));
  const analyses = Object.fromEntries(manyClips.map((item, takeIndex) => [item.job_id, {
    version: 1,
    assetId: item.job_id,
    duration: 10,
    provider: 'fal-wizper',
    transcript: 'four groups',
    language: 'en',
    chunks: Array.from({ length: 4 }, (_, groupIndex) => ({
      start: groupIndex * 2,
      end: groupIndex * 2 + 0.4,
      text: `take${takeIndex}-word${groupIndex}`,
    })),
  }]));
  const plan = buildSpeechAwareCutPlan({ clips: manyClips, analyses });
  const warning = plan.warningDetails.find((item) => item.code === 'segment_limit_reached');
  assert.equal(plan.segments.length, 10);
  assert.equal(warning.parameters.mergedGroups, 2);
  assert.equal(warning.parameters.omittedGroups, 0);
  assert.deepEqual(plan.segments.flatMap((segment) => segment.label.split(' ')),
    Array.from({ length: 3 }, (_, take) => Array.from({ length: 4 }, (_, word) => `take${take}-word${word}`)).flat());
});

test('more than ten source clips return a distinct structured source-limit error', () => {
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
  assert.throws(
    () => buildSpeechAwareCutPlan({ clips: manyClips, analyses }),
    (error) => error?.code === 'source_clip_limit_reached' && error?.parameters?.sourceClips === 11,
  );
});

test('speech-aware planning refuses to cut an over-budget phrase at sixty seconds', () => {
  const duration = 90;
  const normalized = normaliseWizperResult({
    assetId: 'long',
    duration,
    result: { text: 'continuous speech', languages: ['en'], chunks: [{ timestamp: [0, 80], text: 'continuous speech' }] },
  }).analysis;
  assert.throws(
    () => buildSpeechAwareCutPlan({ clips: [{ job_id: 'long', duration }], analyses: { long: normalized } }),
    (error) => error?.code === 'unit_exceeds_budget' && error?.parameters?.end === 80,
  );
});

test('pauses in a later take beyond the output cap are not reported as removed', () => {
  const clips = [{ job_id: 'first', duration: 59 }, { job_id: 'later', duration: 40 }];
  const analyses = {
    first: { version: 1, assetId: 'first', duration: 59, provider: 'fal-wizper', transcript: 'first', language: 'en', chunks: [{ start: 0, end: 59, text: 'first' }] },
    later: { version: 1, assetId: 'later', duration: 40, provider: 'fal-wizper', transcript: 'later', language: 'en', chunks: Array.from({ length: 10 }, (_, index) => ({ start: index * 3, end: index * 3 + 1, text: `later ${index}` })) },
  };
  const plan = buildSpeechAwareCutPlan({ clips, analyses });
  assert.equal(plan.totalDuration, 60);
  assert.equal(plan.silenceRemoved, 0);
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
  assert.ok(!wordPlan.warningDetails.some((warning) => warning.code === 'phrase_timing'));
  assert.ok(phrasePlan.warningDetails.some((warning) => warning.code === 'phrase_timing'));
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
  assert.ok(!without.warnings.includes('join_review'));
  assert.ok(withRemoval.warnings.includes('join_review'));
  assert.ok(withRemoval.qualityChecks.some((check) => check.code === 'join_review'));
});

test('a reviewed removal that intersects words drops complete units instead of clipping them', () => {
  const analysis = normaliseScribeResult({ assetId: clip.job_id, duration: clip.duration, result: {
    language_code: 'eng', text: 'hello filler there',
    words: [
      { type: 'word', text: 'hello', start: 0.5, end: 0.8 },
      { type: 'word', text: 'filler', start: 0.9, end: 1.2 },
      { type: 'word', text: 'there', start: 1.3, end: 1.6 },
    ],
  } }).analysis;
  const plan = buildSpeechAwareCutPlan({
    clips: [clip],
    analyses: { [clip.job_id]: analysis },
    removals: [{ takeId: clip.job_id, start: 0.75, end: 1.0 }],
  });
  assert.ok(plan.segments.every((segment) => analysis.chunks.every((word) => (
    !(word.start < segment.start && segment.start < word.end)
    && !(word.start < segment.end && segment.end < word.end)
  ))));
  assert.ok(!plan.qualityChecks.some((check) => check.code === 'clipped_timed_unit'));
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
  assert.equal(removed.removalsApplied, 1, 'a fully removed standalone filler is still reported as applied');
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
  assert.ok(plan.warningDetails.some((warning) => warning.code === 'removal_retained'));
});

test('the sixty-second cap stops at the last complete timed unit', () => {
  const longClip = { job_id: 'cap-take', name: 'Long take', duration: 70, in_s: 0, out_s: 70 };
  const analysis = {
    version: 1, assetId: longClip.job_id, duration: 70, provider: 'fal-scribe-v2', transcript: 'first crossing', language: 'en', timingQuality: 'word',
    chunks: [{ start: 0, end: 59, text: 'first' }, { start: 59.7, end: 60.3, text: 'crossing' }],
  };
  const plan = buildSpeechAwareCutPlan({ clips: [longClip], analyses: { [longClip.job_id]: analysis } });
  assert.equal(plan.totalDuration, 59);
  assert.equal(plan.segments.at(-1).end, 59);
  assert.equal(plan.silenceRemoved, 0, 'speech omitted by the output cap is not reported as silence removal');
  assert.equal(buildSpeechAwareCutPlan({
    clips: [longClip], analyses: { [longClip.job_id]: analysis }, removals: [{ takeId: longClip.job_id, start: 65, end: 66 }],
  }).removalsApplied, 0, 'removals beyond the rendered cap are not reported as applied');
  assert.ok(plan.warningDetails.some((warning) => warning.code === 'output_limit_reached'));
});

test('a non-hundredth word end at the cap is canonicalized without clipping the word', () => {
  const duration = 70;
  const analysis = {
    version: 1, assetId: 'cap-rounding', duration, provider: 'fal-scribe-v2', transcript: 'first crossing', language: 'en',
    chunks: [{ start: 0, end: 59.123, text: 'first' }, { start: 59.7, end: 60.3, text: 'crossing' }],
  };
  const plan = buildSpeechAwareCutPlan({ clips: [{ job_id: 'cap-rounding', duration }], analyses: { 'cap-rounding': analysis } });
  assert.equal(plan.segments.at(-1).end, 59.12);
  assert.equal(Number((plan.segments.at(-1).end * 100).toFixed(8)) % 1, 0);
});

test('a trim through a timed unit drops the partial unit instead of restoring trimmed footage', () => {
  const trimmed = { job_id: 'trim-take', name: 'Trimmed take', duration: 8, in_s: 2, out_s: 6 };
  const analysis = {
    version: 1, assetId: trimmed.job_id, duration: 8, provider: 'fal-scribe-v2', transcript: 'partial kept', language: 'en', timingQuality: 'word',
    chunks: [{ start: 1.8, end: 2.4, text: 'partial' }, { start: 3, end: 3.5, text: 'kept' }],
  };
  const plan = buildSpeechAwareCutPlan({ clips: [trimmed], analyses: { [trimmed.job_id]: analysis } });
  assert.ok(plan.segments.every((segment) => segment.start >= 2 && segment.end <= 6));
  assert.equal(plan.segments.some((segment) => segment.label.includes('partial')), false);
  assert.equal(plan.warningDetails.find((warning) => warning.code === 'trim_intersects_unit').parameters.count, 1);
});

test('padding never leaks back into a dropped trim-boundary word', () => {
  const trimmed = { job_id: 'trim-padding', name: 'Trim padding', duration: 8, in_s: 2, out_s: 6 };
  const analysis = {
    version: 1, assetId: trimmed.job_id, duration: 8, provider: 'fal-scribe-v2', transcript: 'partial kept', language: 'en', timingQuality: 'word',
    chunks: [{ start: 1.8, end: 2.4, text: 'partial' }, { start: 2.45, end: 3, text: 'kept' }],
  };
  const plan = buildSpeechAwareCutPlan({ clips: [trimmed], analyses: { [trimmed.job_id]: analysis } });
  assert.ok(plan.segments[0].start >= 2.4);
  assert.equal(plan.segments[0].label, 'kept');
});

test('an over-budget phrase is rejected with a structured planner error instead of being cut', () => {
  const longClip = { job_id: 'phrase-take', name: 'Phrase take', duration: 70, in_s: 0, out_s: 70 };
  const analysis = {
    version: 1, assetId: longClip.job_id, duration: 70, provider: 'fal-wizper', transcript: 'one long phrase', language: 'en', timingQuality: 'phrase',
    chunks: [{ start: 0, end: 61, text: 'one long phrase' }],
  };
  assert.throws(
    () => buildSpeechAwareCutPlan({ clips: [longClip], analyses: { [longClip.job_id]: analysis } }),
    (error) => error?.code === 'unit_exceeds_budget' && error?.parameters?.end === 61,
  );
});

test('an anomalously long first word is rejected with the same structured budget error', () => {
  const longClip = { job_id: 'word-take', name: 'Word take', duration: 70, in_s: 0, out_s: 70 };
  const analysis = {
    version: 1, assetId: longClip.job_id, duration: 70, provider: 'fal-scribe-v2', transcript: 'stretched', language: 'en', timingQuality: 'word',
    chunks: [{ start: 0, end: 61, text: 'stretched' }],
  };
  assert.throws(
    () => buildSpeechAwareCutPlan({ clips: [longClip], analyses: { [longClip.job_id]: analysis } }),
    (error) => error?.code === 'unit_exceeds_budget' && error?.parameters?.end === 61,
  );
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
