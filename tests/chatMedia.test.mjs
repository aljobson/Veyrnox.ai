import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPOSER_KINDS,
  chatMediaModels,
  firstOpenMediaModel,
  mediaGenerationCount,
  mediaGenerationCredits,
  mediaOutputSettings,
  outputDurationLabel,
  resolutionLabel,
  supportedAspect,
  supportedDuration,
  videoAudioLabel,
} from '../app/veyrnox/_lib/chatMedia.js';

const models = [
  { id: 'edit', kind: 'video', isEdit: true, credits: 4 },
  { id: 'agent', kind: 'video', takesPlan: true, credits: 4 },
  { id: 'short', kind: 'video', takesTopic: true, credits: 4 },
  { id: 'closed', kind: 'video', gated: true, credits: 8, durations: [5] },
  { id: 'video', kind: 'video', credits: 9, durations: [5, 10], aspects: ['16:9', '9:16'], presentation: {
    resolutionLabel: '720p', audioIncluded: false, durationByOption: { 5: '6', 10: '10' },
  } },
  { id: 'image', kind: 'image', credits: 2 },
];

test('chat media modes only list direct generation models and prefer an open one', () => {
  assert.deepEqual(chatMediaModels(models, COMPOSER_KINDS.VIDEO).map((m) => m.id), ['closed', 'video']);
  assert.equal(firstOpenMediaModel(models, COMPOSER_KINDS.VIDEO).id, 'video');
  assert.equal(firstOpenMediaModel(models, COMPOSER_KINDS.AUDIO), null);
});

test('output choices retain false and reset unsupported values when the model changes', () => {
  const model = { kind: 'video', credits: 28, resolutions: ['480p', '720p'], audioOptions: [true, false],
    presentation: { resolutionLabel: '720p', audioIncluded: true } };
  assert.deepEqual(mediaOutputSettings(model, null, null), { output_resolution: '720p', audio_enabled: true });
  assert.deepEqual(mediaOutputSettings(model, '480p', false), { output_resolution: '480p', audio_enabled: false });
  assert.deepEqual(mediaOutputSettings(model, '1080p', 'false'), { output_resolution: '720p', audio_enabled: true });
  assert.deepEqual(mediaOutputSettings(models[4], '480p', false), {});
  assert.equal(mediaGenerationCredits(model, 5, 1), 28);
  assert.equal(videoAudioLabel(model, false), 'Audio off');
  assert.equal(resolutionLabel(model, '480p'), '480p');
});

test('duration, aspect, quantity and credits stay inside the selected model contract', () => {
  const video = models[4];
  assert.equal(supportedDuration(video, 10), 10);
  assert.equal(supportedDuration(video, 7), 5);
  assert.equal(supportedAspect(video, '9:16'), '9:16');
  assert.equal(supportedAspect(video, '1:1'), '16:9');
  assert.equal(mediaGenerationCount(video, 4), 1);
  assert.equal(mediaGenerationCount(models[5], 4), 4);
  assert.equal(mediaGenerationCredits(video, 10, 4), 18);
  assert.equal(mediaGenerationCredits(models[5], 5, 4), 8);
});

test('the composer describes the priced output without inventing selectable tiers', () => {
  const video = models[4];
  assert.equal(outputDurationLabel(video, 5), '6s');
  assert.equal(outputDurationLabel(video, 10), '10s');
  assert.equal(resolutionLabel(video), '720p');
  assert.equal(videoAudioLabel(video), 'Audio off');
  assert.equal(videoAudioLabel({ presentation: { audioIncluded: true } }), 'Audio on');
  assert.equal(videoAudioLabel({}), 'Audio model default');
});
