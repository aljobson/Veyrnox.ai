import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL_TEMPLATES } from '../app/veyrnox/_lib/templates.js';
import { SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';
import { templateHandoffVisual, templateNeedsSource } from '../app/veyrnox/_lib/templateHandoff.js';
import { modelIdForName, presetHref } from '../app/veyrnox/_lib/tokens.js';
import { SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/sourcePromptRecords.js';

test('web Create submits React state to preserve a template CRLF prompt despite textarea LF normalization', () => {
  const prompt = SOURCE_PROMPT_RECORDS['community-warrior-standoff'].prompt;
  assert.ok(prompt.includes('\r\n'), 'real captured CRLF fixture');
  const textareaValue = prompt.replace(/\r\n/g, '\n');
  assert.notEqual(textareaValue, prompt, 'reading the textarea value would lose captured CR bytes');
  const web = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');
  const body = web.match(/function finalPrompt\(\) \{([\s\S]*?)\n  \}/)[1];
  const prepare = new Function('prompt', 'templateData', 'model', 'characterOn', 'takesCamera', 'cinemaOn', 'recoveredPrompt', body);
  assert.deepEqual(Buffer.from(prepare(prompt, { prompt }, {}, false, false, false)), Buffer.from(prompt));
  assert.notEqual(prepare(textareaValue, { prompt }, {}, false, false, false), prompt,
    'byte-exactness depends on unchanged React state matching the captured template');
  assert.match(web, /prompt: finalPrompt\(\)/, 'submission uses state preparation');
  assert.doesNotMatch(web, /new FormData\(|\.current\.value|querySelector\([^)]*textarea/, 'submission must not reread normalized DOM text');
});

test('every template remains visibly linked from its recipe page into Create', () => {
  assert.equal(ALL_TEMPLATES.length, 1799, 'audit every public template');
  for (const preset of ALL_TEMPLATES) {
    assert.match(presetHref(preset), new RegExp(`[?&]preset=${preset.id}(?:&|$)`), preset.id);
    assert.ok(modelIdForName(preset.model), `${preset.id} opens a known model`);
    const visual = templateHandoffVisual({ ...preset, clip: SHOWCASE_CLIPS[preset.clipKey] }); // the API sends the clip with the template
    assert.ok(visual, `${preset.id} has a Create handoff visual`);
    if (preset.clipKey) {
      assert.equal(visual.kind, 'video', `${preset.id} keeps its exact preview`);
      assert.equal(visual.video, SHOWCASE_CLIPS[preset.clipKey].video);
      assert.equal(visual.poster, SHOWCASE_CLIPS[preset.clipKey].poster);
    } else {
      assert.equal(visual.kind, 'artwork', `${preset.id} gets an artwork reference`);
    }
  }
});

test('template preview is reference-only and source requirements stay explicit', () => {
  for (const preset of ALL_TEMPLATES) {
    assert.equal(templateNeedsSource(preset), preset.needs?.trim() || '', preset.id);
    assert.equal(Object.hasOwn(templateHandoffVisual(preset), 'source'), false, `${preset.id} preview must not masquerade as user input`);
  }
  const component = readFileSync(new URL('../app/veyrnox/_components/TemplateHandoffCard.js', import.meta.url), 'utf8');
  assert.match(component, /data-testid="create-template-handoff"/);
  assert.match(component, /<video[\s\S]*controls/);
  assert.match(component, /app\.create\.templateReferenceOnly/);
  assert.match(component, /app\.create\.chooseTemplateSource/);
  assert.match(component, /presets\.detail\.sourceAspect/);
  assert.match(component, /TemplateArtwork/);
  assert.doesNotMatch(component, /OriginalTemplateArtwork/);
  assert.doesNotMatch(component, /setSources|writeStudioDraft|Generate/);
});

test('a matching Create goal filter keeps the linked template and its exact model', () => {
  const create = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');
  assert.match(create, /if \(activeTemplate && model && \(nextGoal === 'all' \|\| model\.kind === nextGoal\)\) return;/);
  assert.ok(
    create.indexOf("if (activeTemplate && model && (nextGoal === 'all' || model.kind === nextGoal)) return;") < create.indexOf('setPresetParam(null);', create.indexOf('function pickGoal')),
    'the compatible template guard runs before the deliberate replacement path',
  );
});

test('all non-template Create entry points remain independently wired', () => {
  const roots = [
    ['Chat draft', '../app/veyrnox/_lib/chatStudioDraft.js', /writeStudioDraft/, /\/app\/create\?model=/],
    ['Oddling', '../app/veyrnox/_components/OddlingStudio.js', /oddlingPicks/, /passport=1/],
    ['Film Studio', '../app/veyrnox/_components/film/FilmPromptOutput.js', /writeStudioDraft/, /\/app\/create\?model=/],
    ['landing prompt', '../app/veyrnox/_components/PriceSlip.js', /writeStudioDraft/, /router\.push/],
  ];
  for (const [label, path, stored, destination] of roots) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, stored, `${label} keeps its draft payload`);
    assert.match(source, destination, `${label} keeps its Create destination`);
  }
});

test('real whitespace-bearing templates survive web Create, Film Studio, chat and native submit byte for byte', async () => {
  const { exactSourcePromptRecord } = await import('../app/veyrnox/_lib/sourcePromptRecords.js');
  const { templateById } = await import('../app/veyrnox/_lib/templates.js');
  const { draftForTemplate } = await import('../app/veyrnox/_lib/templateDraft.js');
  const { writeStudioDraft, takeStudioDraft } = await import('../app/veyrnox/_lib/landingDraft.js');
  const { writeFilmStarter, takeFilmStarter } = await import('../app/veyrnox/_lib/filmTemplateDraft.js');
  const { filmFromTemplate } = await import('../app/veyrnox/_lib/filmStudio.js');
  const { writeTemplateChatDraft, takeTemplateChatDraft } = await import('../app/veyrnox/_lib/chatTemplateDraft.js');
  const { CHAT_USER_TEXT_MAX } = await import('../lib/chatLimits.js');
  const { validateTurn } = await import('../lib/chat.js');
  const { fixture } = await import('./helpers/publicSiteRender.mjs');
  const store = new Map();
  const storage = { getItem: key => store.get(key), setItem: (key,value) => store.set(key,value), removeItem: key => store.delete(key) };
  const web = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');
  const mobile = readFileSync(new URL('../apps/mobile/src/app/(app)/create/[modelId].tsx', import.meta.url), 'utf8');
  // Execute the production preparation expressions, so a reintroduced trim fails.
  const body = web.match(/function finalPrompt\(\) \{([\s\S]*?)\n  \}/)[1];
  const prepareWeb = new Function('prompt', 'templateData', 'model', 'characterOn', 'takesCamera', 'cinemaOn', 'recoveredPrompt', body);
  const nativeBody = mobile.match(/const withCharacter = ([\s\S]*?);\n    const text = ([\s\S]*?);/);
  const prepareNative = new Function('prompt', 'presetPrompt', 'template', 'takesCharacter', 'characterOn', 'takesCamera', 'cameraOn', 'recoveredPrompt', `const withCharacter = ${nativeBody[1]}; return ${nativeBody[2]};`);
  let sent;
  const mocks = { './appCache': { getCacheUser: () => 'test' }, 'expo-crypto': { randomUUID: () => 'test-id' }, './aiConsent': {}, './api': { ApiError: Error }, './network': {}, './createOptions': { inputsForIndex: value => value }, './media': { mediaApi: () => ({ createGeneration: async request => { sent = request; return { job_id: 'job' }; } }) }, './i18n': { t: key => key }, './failedJob': {} };
  const native = fixture('en', '/presets', { moduleMocks: mocks }).load('apps/mobile/src/lib/generationSubmit.ts');
  for (const id of ['pov-dragon-flight', 'coliseum-drift', 'fashion-halloween']) {
    const prompt = exactSourcePromptRecord(id).prompt, preset = templateById(id), modelId = modelIdForName(preset.model);
    assert.ok(prompt.endsWith('\n'), id);
    if (id === 'pov-dragon-flight') assert.ok(prompt.endsWith('\n\n'));
    const draft = draftForTemplate(preset, modelId, id);
    assert.equal(draft.prompt, prompt);
    assert.equal(writeStudioDraft(storage, { ...draft, model: modelId }), true);
    assert.equal(takeStudioDraft(storage, modelId).prompt, prompt);
    assert.equal(prepareWeb(prompt, preset, {}, false, false, false), prompt);
    assert.equal(prepareWeb(prompt, null, {}, false, false, false, prompt), prompt, 'recovered web draft');
    assert.equal(writeFilmStarter(storage, preset, prompt, 60), true);
    assert.equal(filmFromTemplate(takeFilmStarter(storage)).script, prompt);
    if (prompt.length <= CHAT_USER_TEXT_MAX) {
      assert.equal(writeTemplateChatDraft(storage, preset, prompt), true);
      const chat = takeTemplateChatDraft(storage);
      assert.equal(chat.prompt, prompt);
      assert.equal(validateTurn({ text: chat.prompt, idempotency_key: 'exact-whitespace-proof' }).text, prompt);
    } else {
      assert.equal(writeTemplateChatDraft(storage, preset, prompt), false, 'existing chat cap rejects whole text without truncation');
    }
    assert.equal(prepareNative(prompt, prompt, { id }, false, false, false, false), prompt);
    assert.equal(prepareNative(prompt, undefined, null, false, false, false, false, prompt), prompt, 'recovered native draft');
    await native.createGenerationSubmit().run({}, { modelId, prompt: prepareNative(prompt, prompt, { id }, false, false, false, false), confirmedCredits: 32, durationSeconds: 10, preset: id });
    assert.equal(sent.prompt, prompt);
  }
  assert.equal(prepareWeb(' edited \n', { prompt: 'original' }, {}, false, false, false), 'edited');
  assert.equal(prepareNative(' edited \n', 'original', {}, false, false, false, false), 'edited');
  assert.match(web, /setRecoveredPrompt\(saved\.prompt\)/);
  assert.match(mobile, /setRecoveredPrompt\(d\.prompt\)/);
  const chatSend = readFileSync(new URL('../app/veyrnox/_components/chat/useChatSend.js', import.meta.url), 'utf8');
  assert.match(chatSend, /const content = text;/);
});
