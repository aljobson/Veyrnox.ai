import test from 'node:test';
import assert from 'node:assert/strict';
import { templateModelSwapIssue } from '../app/veyrnox/_lib/createModelChange.js';
import { ownPromptOf } from '../app/veyrnox/_lib/privateTemplatePrompt.js';
import { templateById } from '../app/veyrnox/_lib/templates.js';
import { templateModelId } from '../app/veyrnox/_lib/tokens.js';

const quickChange = templateById('seedance-quick-change-2');
const quickChangePrompt = ownPromptOf(quickChange);
const quickChangeModel = { id: templateModelId(quickChange), kind: 'video' };

test('a linked template cannot select a model that rejects its exact prompt', () => {
  assert.equal(quickChangePrompt.length, 2772);
  assert.deepEqual(templateModelSwapIssue({
    template: quickChange,
    templateModel: quickChangeModel,
    targetModel: { id: 'kling-3.0-standard-i2v', kind: 'video', promptMax: 2500 },
    prompt: quickChangePrompt,
  }), { code: 'prompt-too-long', count: 2772, max: 2500 });

  assert.deepEqual(templateModelSwapIssue({
    template: quickChange,
    templateModel: quickChangeModel,
    targetModel: { id: 'seedance-2.0-reference', kind: 'video', promptMax: 20_000 },
    prompt: quickChangePrompt,
  }), { code: 'template-model' });
});

test('sound-effect templates do not silently become speech scripts', () => {
  const template = { id: 'city-rain-window', kind: 'audio' };
  const soundModel = { id: 'suno-sounds', kind: 'audio', isSpeech: false };
  assert.deepEqual(templateModelSwapIssue({
    template,
    templateModel: soundModel,
    targetModel: { id: 'qwen3-tts', kind: 'audio', isSpeech: true },
    prompt: 'Rain on a city window with distant traffic.',
  }), { code: 'audio-purpose' });
  assert.deepEqual(templateModelSwapIssue({
    template,
    templateModel: soundModel,
    targetModel: { id: 'elevenlabs-sfx-v2', kind: 'audio', isSpeech: false },
    prompt: 'Rain on a city window with distant traffic.',
  }), { code: 'template-model' });
});

test('a reviewed Kling template cannot be charged as an unreviewed Seedance template run', () => {
  assert.deepEqual(templateModelSwapIssue({
    template: { id: 'community-midnight-sports-drive', kind: 'video' },
    templateModel: { id: 'kling-3.0-standard-i2v', kind: 'video' },
    targetModel: { id: 'seedance-2.0-fast', kind: 'video', promptMax: 20_000 },
    prompt: 'A midnight sports-car drive through a neon city.',
  }), { code: 'template-model' });
});

test('model choices stay unrestricted when no template is linked or the template model remains selected', () => {
  assert.equal(templateModelSwapIssue({ template: null, templateModel: null, targetModel: quickChangeModel, prompt: quickChangePrompt }), null);
  assert.equal(templateModelSwapIssue({ template: quickChange, templateModel: quickChangeModel, targetModel: quickChangeModel, prompt: quickChangePrompt }), null);
});

test('Create keeps the linked-template model rule visible beside the model picker', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8'));
  assert.match(source, /data-testid="create-template-model-lock"/);
  assert.match(source, /linkedTemplate\s*&&[\s\S]*t\('app\.create\.templateModelSwitch'\)/);
});
