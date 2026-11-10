import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TTS_MODEL_ID,
  LIP_SYNC_ENGINE_CONTRACTS,
  LONG_FORM_SYNC_MODES,
  PERFORMANCE_WORKFLOWS,
  TALKING_PHOTO_MODEL_CONTRACTS,
  VIDEO_LIP_SYNC_MODEL_CONTRACTS,
  availablePerformanceModels,
  encodeAudioBufferAsWav,
  estimatedSpeechSeconds,
  knownAudioTooLong,
  performanceQuote,
  lipSyncEngineContract,
  sourceAccept,
  sourceHint,
  speechSourcesFor,
  workflowById,
} from '../app/veyrnox/_lib/performanceStudio.js';

test('Lip Sync exposes two source-specific live engine contracts without inventing a quality mode', () => {
  assert.deepEqual(LIP_SYNC_ENGINE_CONTRACTS.map((contract) => ({
    workflowId: contract.workflowId,
    modelId: contract.modelId,
    sourceLabel: contract.sourceLabel,
    maxSeconds: contract.maxSeconds,
  })), [
    { workflowId: 'video-lip-sync', modelId: 'latentsync', sourceLabel: 'MP4 + speech', maxSeconds: 40 },
    { workflowId: 'talking-photo', modelId: 'kling-avatar-v2', sourceLabel: 'Portrait + speech', maxSeconds: 10 },
  ]);
  assert.equal(lipSyncEngineContract('video-lip-sync').modelLabel, 'LatentSync');
  assert.equal(lipSyncEngineContract({ id: 'talking-photo' }).modelLabel, 'Kling AI Avatar');
  assert.equal(lipSyncEngineContract('missing'), null);
});

test('Talking Photo offers two independently priced executable model contracts', () => {
  assert.deepEqual(TALKING_PHOTO_MODEL_CONTRACTS.map((contract) => contract.id), ['kling-avatar-v2', 'sync-lipsync-v3']);
  assert.deepEqual(workflowById('talking-photo').modelIds, ['kling-avatar-v2', 'sync-lipsync-v3']);
  assert.deepEqual(availablePerformanceModels([
    { id: 'kling-avatar-v2', gated: false },
    { id: 'sync-lipsync-v3', gated: false },
    { id: 'latentsync', gated: false },
  ], 'talking-photo').map((model) => model.id), ['kling-avatar-v2', 'sync-lipsync-v3']);
});

test('Video Lip Sync offers an executable three-minute provider contract', () => {
  assert.deepEqual(VIDEO_LIP_SYNC_MODEL_CONTRACTS.map((contract) => [contract.id, contract.maxSeconds]), [
    ['latentsync', 40],
    ['sync-lipsync-1.9-long', 180],
  ]);
  assert.deepEqual(workflowById('video-lip-sync').modelIds, ['latentsync', 'sync-lipsync-1.9-long']);
  assert.equal(workflowById('video-lip-sync').scriptLimit, 1000);
  assert.deepEqual(LONG_FORM_SYNC_MODES.map((mode) => mode.id), ['cut_off', 'loop', 'bounce', 'silence', 'remap']);
  assert.deepEqual(availablePerformanceModels([
    { id: 'latentsync', gated: false },
    { id: 'sync-lipsync-1.9-long', gated: false },
    { id: 'kling-avatar-v2', gated: false },
  ], 'video-lip-sync').map((model) => model.id), ['latentsync', 'sync-lipsync-1.9-long']);
});

test('the preview exposes nine runnable performance workflows and labels the rest as plans', () => {
  const available = PERFORMANCE_WORKFLOWS.filter((workflow) => workflow.status === 'available');
  assert.deepEqual(available.map((workflow) => workflow.id), ['talking-photo', 'product-presenter', 'talking-cartoon', 'talking-animal', 'baby-podcast', 'talking-object', 'video-lip-sync', 'singing-photo', 'video-dubbing']);
  assert.deepEqual(available.map((workflow) => workflow.modelId), ['kling-avatar-v2', 'kling-avatar-v2', 'kling-avatar-v2', 'kling-avatar-v2', 'kling-avatar-v2', 'kling-avatar-v2', 'latentsync', 'kling-avatar-v2', 'latentsync']);
  assert.deepEqual(available.map((workflow) => workflow.maxSeconds), [10, 10, 10, 10, 10, 10, 40, 10, 40]);
  assert.deepEqual(available.map((workflow) => workflow.scriptLimit), [1000, 600, 600, 600, 600, 600, 1000, 0, 360]);
  assert.equal(DEFAULT_TTS_MODEL_ID, 'minimax-speech-2.6-hd');
  assert.ok(PERFORMANCE_WORKFLOWS.filter((workflow) => workflow.status === 'planned').length >= 1);
  assert.deepEqual(workflowById('dialogue'), {
    id: 'dialogue',
    label: 'Dialogue',
    eyebrow: '2–4 SPEAKERS',
    description: 'Stage ordered turns, distinct stock voices and reusable audio.',
    status: 'tool',
    href: '/app/dialogue',
  });
});

test('Product Presenter animates one approved composite with the real avatar contract', () => {
  const workflow = workflowById('product-presenter');
  assert.equal(workflow.modelId, 'kling-avatar-v2');
  assert.equal(workflow.maxSeconds, 10);
  assert.equal(workflow.scriptLimit, 600);
  assert.match(sourceHint(workflow), /presenter-and-product composite/);
  assert.deepEqual(speechSourcesFor(workflow).map((source) => source.id), ['script', 'upload', 'record']);
});

test('Talking Object uses the executable character path with an explicit compatibility boundary', () => {
  const workflow = workflowById('talking-object');
  assert.equal(workflow.modelId, 'kling-avatar-v2');
  assert.equal(workflow.maxSeconds, 10);
  assert.equal(workflow.scriptLimit, 600);
  assert.match(sourceHint(workflow), /object character with a clear designed face and mouth/);
  assert.deepEqual(speechSourcesFor(workflow).map((source) => source.id), ['script', 'upload', 'record']);
});

test('Synthetic Baby Podcast uses the executable character path without real child identity or voice', () => {
  const workflow = workflowById('baby-podcast');
  assert.equal(workflow.modelId, 'kling-avatar-v2');
  assert.equal(workflow.maxSeconds, 10);
  assert.equal(workflow.scriptLimit, 600);
  assert.match(sourceHint(workflow), /fully synthetic baby character/);
  assert.deepEqual(speechSourcesFor(workflow).map((source) => source.id), ['script', 'upload', 'record']);
});

test('Talking Animal uses the executable talking-character path with animal-specific limits', () => {
  const workflow = workflowById('talking-animal');
  assert.equal(workflow.modelId, 'kling-avatar-v2');
  assert.equal(workflow.maxSeconds, 10);
  assert.equal(workflow.scriptLimit, 600);
  assert.match(sourceHint(workflow), /one animal with a clear front-facing head/);
  assert.deepEqual(speechSourcesFor(workflow).map((source) => source.id), ['script', 'upload', 'record']);
});

test('Talking Illustration uses the executable talking-character path with explicit limits', () => {
  const workflow = workflowById('talking-cartoon');
  assert.equal(workflow.modelId, 'kling-avatar-v2');
  assert.equal(workflow.maxSeconds, 10);
  assert.equal(workflow.scriptLimit, 600);
  assert.match(sourceHint(workflow), /original or licensed character/);
  assert.deepEqual(speechSourcesFor(workflow).map((source) => source.id), ['script', 'upload', 'record']);
});

test('Video Dubbing uses the executable reviewed-translation path', () => {
  const workflow = workflowById('video-dubbing');
  assert.equal(workflow.defaultLanguage, 'English');
  assert.deepEqual(workflow.modelIds, ['latentsync', 'sync-lipsync-1.9-long']);
  assert.equal(sourceAccept(workflow), 'video/mp4');
  assert.deepEqual(speechSourcesFor(workflow).map((source) => source.id), ['script', 'upload', 'record']);
  assert.deepEqual(availablePerformanceModels([
    { id: 'latentsync', gated: false },
    { id: 'sync-lipsync-1.9-long', gated: false },
  ], workflow).map((model) => model.id), ['latentsync', 'sync-lipsync-1.9-long']);
  assert.match(sourceHint(workflow), /40s/);
  assert.match(sourceHint({ ...workflow, maxSeconds: 180 }), /180s/);
});

test('Singing Photo accepts only uploaded or recorded cleared audio', () => {
  assert.deepEqual(speechSourcesFor('singing-photo').map((source) => source.id), ['upload', 'record']);
  assert.equal(workflowById('singing-photo').defaultSpeechSource, 'upload');
  assert.match(sourceAccept('singing-photo'), /image\/jpeg/);
});

test('workflow lookup and model selection fail safely to the talking-photo contract', () => {
  assert.equal(workflowById('missing').id, 'talking-photo');
  assert.equal(sourceAccept('video-lip-sync'), 'video/mp4');
  assert.match(sourceAccept('talking-photo'), /image\/png/);
  assert.deepEqual(availablePerformanceModels([
    { id: 'latentsync', gated: false },
    { id: 'kling-avatar-v2', gated: true },
  ], 'video-lip-sync').map((model) => model.id), ['latentsync']);
  assert.deepEqual(availablePerformanceModels([], 'video-lip-sync'), []);
});

test('the quote includes speech only when a script needs a separate TTS job', () => {
  assert.deepEqual(performanceQuote({ lipSyncCredits: 35, speechSource: 'script', ttsCredits: 4 }), {
    lipSyncCredits: 35, speechCredits: 4, captionsCredits: 0, totalCredits: 39,
  });
  assert.deepEqual(performanceQuote({ lipSyncCredits: 13, speechSource: 'upload', ttsCredits: 4 }), {
    lipSyncCredits: 13, speechCredits: 0, captionsCredits: 0, totalCredits: 13,
  });
  assert.deepEqual(performanceQuote({ lipSyncCredits: -5, speechSource: 'script', ttsCredits: Number.NaN }), {
    lipSyncCredits: 0, speechCredits: 0, captionsCredits: 0, totalCredits: 0,
  });
  assert.deepEqual(performanceQuote({ lipSyncCredits: 35, speechSource: 'upload', captionsCredits: 7 }), {
    lipSyncCredits: 35, speechCredits: 0, captionsCredits: 7, totalCredits: 42,
  });
});

test('script duration is conservative and empty text costs no time', () => {
  assert.equal(estimatedSpeechSeconds(''), 0);
  assert.equal(estimatedSpeechSeconds('one two three four five'), 3);
  assert.equal(estimatedSpeechSeconds('one two', 2), 1);
});

test('only a known over-limit audio duration blocks the selected engine', () => {
  assert.equal(knownAudioTooLong(10, 10), false);
  assert.equal(knownAudioTooLong(10.01, 10), true);
  assert.equal(knownAudioTooLong(40, 40), false);
  assert.equal(knownAudioTooLong(180.1, 180), true);
  assert.equal(knownAudioTooLong(undefined, 10), false);
  assert.equal(knownAudioTooLong(Number.NaN, 10), false);
});

test('browser recordings are encoded as interleaved 16-bit PCM WAV', () => {
  const channels = [new Float32Array([-2, -0.5, 0, 0.5, 2]), new Float32Array([1, 0, -1, 0.25, -0.25])];
  const wav = encodeAudioBufferAsWav({
    numberOfChannels: 2,
    length: 5,
    sampleRate: 8000,
    getChannelData: (channel) => channels[channel],
  });
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const ascii = (offset, length) => String.fromCharCode(...wav.subarray(offset, offset + length));
  assert.equal(ascii(0, 4), 'RIFF');
  assert.equal(ascii(8, 4), 'WAVE');
  assert.equal(ascii(36, 4), 'data');
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 8000);
  assert.equal(view.getUint32(40, true), 20);
  assert.equal(wav.byteLength, 64);
  assert.equal(view.getInt16(44, true), -32768, 'negative samples clip at -1');
  assert.equal(view.getInt16(46, true), 32767, 'positive samples clip at +1');
  assert.throws(() => encodeAudioBufferAsWav({}), /invalid_audio_buffer/);
});
