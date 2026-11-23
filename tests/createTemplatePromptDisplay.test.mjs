import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isUneditedTemplatePrompt, templatePromptHidden } from '../app/veyrnox/_lib/templatePromptDisplay.js';
import { templateInputs } from '../app/veyrnox/_lib/templateGenerate.js';
import { LOCALES } from '../lib/i18n/locales.mjs';

const template = { id: 'long-recipe', kind: 'video', prompt: 'Adapted recipe', sourcePrompt: 'Exact recipe '.repeat(600), sourcePromptOrigin: 'community-source-exact', negativePrompt: 'blur' };
const page = readFileSync('app/veyrnox/app/create/page.js', 'utf8');
const card = readFileSync('app/veyrnox/_components/TemplateHandoffCard.js', 'utf8');
const ready = readFileSync('app/veyrnox/_components/TemplatePromptReady.js', 'utf8');
const CODES = ['source_aspect_out_of_range', 'source_too_small', 'source_type_unsupported', 'source_frame_rate_unknown', 'source_frame_rate_out_of_range'];
const UI = ['app.create.sources.fit.refused', 'app.create.sources.fit.trimmed', 'app.create.templatePrompt.ready', 'app.create.templatePrompt.help', 'app.create.templatePrompt.edit'];

test('an unedited template prompt is hidden, and Edit reveals it', () => {
  assert.equal(templatePromptHidden(template, template.prompt, null), true);
  assert.equal(templatePromptHidden(template, template.sourcePrompt, null), true);
  assert.equal(templatePromptHidden(template, template.sourcePrompt, template.id), false, 'revealed');
  assert.equal(templatePromptHidden(template, template.sourcePrompt, 'another-template'), true);
});

test('an edited prompt is a custom prompt and is always shown', () => {
  assert.equal(isUneditedTemplatePrompt(template, `${template.sourcePrompt} and more`), false);
  assert.equal(templatePromptHidden(template, 'my own words', null), false);
  assert.equal(templatePromptHidden(null, 'my own words', null), false);
  assert.equal(templatePromptHidden(template, '', null), false);
});

test('hiding the prompt leaves the request inputs identical', () => {
  const model = { id: 'kling-3.0-i2v', kind: 'video', takesNegative: true };
  const build = () => templateInputs(template, model, { prompt: template.sourcePrompt, aspect: '9:16', durationSeconds: 5, aspectOptions: ['9:16'] });
  const inputs = build();
  templatePromptHidden(template, template.sourcePrompt, null);
  assert.deepEqual(build(), inputs);
  assert.equal(inputs.prompt, template.sourcePrompt);
  assert.equal(inputs.negative_prompt, 'blur');
  assert.match(page, /prompt: finalPrompt\(\),/);
  assert.match(page, /const uneditedTemplate = prompt === fidelity\?\.sourcePrompt;/);
  assert.match(page, /template_id: run\.templateId,/);
});

test('no summary or accessible name repeats the hidden prompt', () => {
  assert.match(card, /settings && !settings\.promptHidden &&/);
  assert.match(page, /promptDisplay\.unedited \? \{ promptHidden: true \}/);
  assert.match(page, /promptDisplay\.hidden \? <TemplatePromptReady/);
  assert.doesNotMatch(ready, /prompt=|settings|\{prompt\}/);
});

test('the Edit control is a named, keyboard-reachable 44 px button with a focus ring', () => {
  assert.match(ready, /<button type="button"/);
  assert.match(ready, /min-h-11/);
  assert.match(ready, /focus-visible:outline-2/);
  assert.match(ready, /app\.create\.templatePrompt\.edit/);
  assert.match(ready, /role="status"/);
  assert.match(page, /<TemplatePromptReady assistantTarget="create\.prompt"/);
});

test('video templates are hidden on every web surface; image and audio templates are not', async () => {
  const { isVideoTemplate, jobHistoryLabels } = await import('../app/veyrnox/_lib/templatePromptVisibility.js');
  assert.equal(isVideoTemplate({ id: 'v', model: 'Kling 3.0 · I2V' }), true);
  assert.equal(isVideoTemplate({ id: 'i', kind: 'image', prompt: 'x' }), false);
  assert.equal(isVideoTemplate({ id: 'a', kind: 'audio', prompt: 'x' }), false);
  assert.equal(templatePromptHidden({ id: 'i', kind: 'image', prompt: 'x' }, 'x', null), false);
  assert.doesNotMatch(JSON.stringify(jobHistoryLabels({ ...template, name: 'Long recipe' }, template.sourcePrompt)), /Exact recipe/);
  assert.deepEqual(jobHistoryLabels(template, 'my own words'), { prompt: 'my own words', name: 'my own words' });
  for (const [file, pattern] of [
    ['app/veyrnox/_components/PresetCard.js', /!isVideoTemplate\(preset\) && <div/],
    ['app/veyrnox/_components/TemplatePicker.js', /kind !== 'video' && <p/],
    ['app/veyrnox/_components/TemplateRecipe.js', /promptView\.hidden \? /],
    ['app/veyrnox/_components/TemplateRecreate.js', /promptHidden \? /],
    ['app/veyrnox/_components/chat/ChatWorkspace.js', /templateTextHidden \? <TemplatePromptReady/],
    ['app/veyrnox/_lib/useTemplateGenerate.js', /jobHistoryLabels\(preset, prompt\)/],
    ['apps/mobile/src/app/(app)/templates/[id].tsx', /promptHidden \? <TemplatePromptReady/],
    ['apps/mobile/src/app/(app)/create/[modelId].tsx', /templatePromptHidden \? <TemplatePromptReady/],
    ['apps/mobile/src/components/JobProvenance.tsx', /isUneditedVideoTemplateRun/],
  ]) assert.match(readFileSync(file, 'utf8'), pattern, file);
});

test('a chat handoff hides only an unedited video template prompt, and the text sent is unchanged', async () => {
  const { writeTemplateChatDraft, takeTemplateChatDraft } = await import('../app/veyrnox/_lib/chatTemplateDraft.js');
  const store = new Map();
  const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
  writeTemplateChatDraft(storage, template, template.prompt, 1000);
  assert.deepEqual(takeTemplateChatDraft(storage, 1000), { templateId: template.id, prompt: template.prompt, hidePrompt: true });
  writeTemplateChatDraft(storage, template, 'my own words', 1000);
  assert.deepEqual(takeTemplateChatDraft(storage, 1000), { templateId: template.id, prompt: 'my own words' });
});

test('new copy and every added error exist in all 11 locales', async () => {
  const codes = LOCALES.map(locale => locale.code ?? locale);
  assert.equal(codes.length, 11);
  const { ERROR_COPY } = await import('../app/veyrnox/_lib/createErrors.js').catch(() => ({ ERROR_COPY: null }));
  const source = readFileSync('app/veyrnox/_lib/createErrors.js', 'utf8');
  for (const code of CODES) assert.ok(ERROR_COPY ? ERROR_COPY[code] : source.includes(`${code}:`), code);
  for (const locale of codes) {
    const errors = (await import(`../lib/i18n/messages/app/${locale}/data-errors.mjs`)).default;
    const studio = (await import(`../lib/i18n/messages/app/${locale}/create-sources.mjs`)).default;
    for (const code of CODES) assert.ok(errors[`app.create.error.${code}`], `${locale} ${code}`);
    for (const key of UI) assert.ok(studio[key], `${locale} ${key}`);
    assert.match(studio['app.create.sources.fit.refused'], /\{min\}[\s\S]*\{max\}/, locale);
  }
});
