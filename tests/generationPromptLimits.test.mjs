import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { GENERATION_PROMPT_MAX, NEGATIVE_PROMPT_MAX } from '../lib/generationPromptLimits.js';
import { REGISTRY, capabilityFor, checkInputs } from '../lib/modelCapabilities.js';
import { cleanCreateDraft } from '../lib/createDraftRecovery.js';
import { ALL_TEMPLATES } from '../app/veyrnox/_lib/templates.js';
import { draftForTemplate } from '../app/veyrnox/_lib/templateDraft.js';
import { filmStarterForTemplate } from '../app/veyrnox/_lib/filmTemplateDraft.js';
import { modelIdForName } from '../app/veyrnox/_lib/tokens.js';
import { writeStudioDraft, takeStudioDraft } from '../app/veyrnox/_lib/landingDraft.js';
import { GENJUTSU_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/genjutsuSourcePromptRecords.js';
import { HIGGSFIELD_90_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/higgsfieldCommunityExpansion90Records.js';
import { SYNTX_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/syntxSourcePromptRecords.js';
import { SEEDANCE_SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/seedanceSourcePromptRecords.js';
import { sourcePromptAuditForModel } from '../app/veyrnox/_lib/sourcePromptAudit.js';

const sourceRecords = {
  ...GENJUTSU_SOURCE_PROMPT_RECORDS,
  ...HIGGSFIELD_90_SOURCE_PROMPT_RECORDS,
  ...SYNTX_SOURCE_PROMPT_RECORDS,
  ...SEEDANCE_SOURCE_PROMPT_RECORDS,
};

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test('positive generation capabilities use 30,000 or an explicit verified provider cap', () => {
  const providerCaps = new Map([
    ['market:wan/2-5-text-to-video', 800],
    ['market:kling-2.6/text-to-video', 1000],
    ['market:hailuo/02-text-to-video-standard', 1500],
    ['market:nano-banana-pro', 10000],
  ]);
  for (const [endpoint, record] of Object.entries(REGISTRY)) {
    const prompt = record.inputs?.prompt;
    if (!prompt) continue;
    if (record.kind === 'speech') assert.ok(prompt.max <= 2_000, endpoint);
    else assert.equal(prompt.max, providerCaps.get(endpoint) ?? GENERATION_PROMPT_MAX, endpoint);
  }
  assert.equal(NEGATIVE_PROMPT_MAX, 2_000);
});

test('the pre-debit model contract accepts 30,000 characters and rejects 30,001', () => {
  const record = capabilityFor('fal-ai/veo3.1');
  assert.equal(checkInputs(record, { prompt: 'x'.repeat(GENERATION_PROMPT_MAX) }).ok, true);
  assert.deepEqual(checkInputs(record, { prompt: 'x'.repeat(GENERATION_PROMPT_MAX + 1) }), { ok: false, error: 'inputs_invalid:prompt' });
});

test('the reported 3,722-character prompt is preserved, while its unsupported exact-source contract stays copy-only', () => {
  const template = ALL_TEMPLATES.find((item) => item.id === 'event-character-swap');
  const prompt = sourceRecords[template.id].prompt;
  assert.equal(prompt.length, 3_722);
  const exactTemplate = { ...template, prompt, sourcePrompt: prompt, sourcePromptOrigin: 'community-source-exact', sourcePromptRunnable: false };
  assert.equal(draftForTemplate(exactTemplate, modelIdForName(template.model)), null);
  assert.equal(checkInputs(capabilityFor('fal-ai/veo3.1'), { prompt }).ok, true);
  assert.equal(filmStarterForTemplate({ ...template, prompt }, prompt).prompt, prompt);
  assert.equal(cleanCreateDraft({ modelId: modelIdForName(template.model), prompt }).prompt, prompt);
  const storage = memoryStorage();
  assert.equal(writeStudioDraft(storage, { prompt, model: modelIdForName(template.model) }, 1_000), true);
  assert.equal(takeStudioDraft(storage, modelIdForName(template.model), 1_001).prompt, prompt);
});

test('all recorded exact community prompts fit the new contract without truncation', () => {
  const prompts = Object.values(sourceRecords)
    .filter((record) => record.sourcePromptAvailable && typeof record.prompt === 'string')
    .map((record) => record.prompt);
  assert.equal(prompts.length, 366);
  assert.ok(Math.max(...prompts.map((prompt) => prompt.length)) <= GENERATION_PROMPT_MAX);
  assert.ok(prompts.some((prompt) => prompt.length > 20_000));
});

test('product prompt-audit documents keep the recalculated exact-prompt counts', () => {
  const audit = readFileSync('docs/product/template-prompt-audit-2026-10-29.md', 'utf8').replace(/\s+/g, ' ');
  const recipes = readFileSync('docs/product/template-recipes.md', 'utf8').replace(/\s+/g, ' ');
  assert.match(audit, /144 are runnable[^;]+; 221 remain read-only/);
  assert.match(recipes, /144 exact prompts; 221 remain/);
});

test('the formerly clipped 2,077-character exact prompt now fits the product contract whole', () => {
  const template = ALL_TEMPLATES.find((item) => item.id === 'football-showstopper');
  const prompt = sourceRecords[template.id].prompt;
  const audit = sourcePromptAuditForModel(template.id, GENERATION_PROMPT_MAX);
  assert.equal(prompt.length, 2_077);
  assert.equal(audit.characterCount, prompt.length);
  assert.equal(audit.runnable, true);
  assert.equal(audit.modelPromptMax, undefined);
  assert.ok(!audit.issues.includes('model-prompt-limit-exceeded'));
  assert.equal(draftForTemplate({ ...template, prompt, sourcePrompt: prompt, sourcePromptOrigin: 'community-source-exact', sourcePromptRunnable: audit.runnable }, modelIdForName(template.model)).prompt, prompt);
});

test('web, API, MCP and mobile boundaries all reference the shared 30,000 contract', () => {
  const api = readFileSync('app/api/v1/generations/route.js', 'utf8');
  const mcp = readFileSync('lib/veyrnoxMcp.js', 'utf8');
  const mobile = readFileSync('apps/mobile/src/lib/promptLimits.ts', 'utf8');
  const mobileCreate = readFileSync('apps/mobile/src/app/(app)/create/[modelId].tsx', 'utf8');
  const mobileTemplate = readFileSync('apps/mobile/src/app/(app)/templates/[id].tsx', 'utf8');
  const mobileMake = readFileSync('apps/mobile/src/components/chat/MakePanel.tsx', 'utf8');
  const mobileChat = readFileSync('apps/mobile/src/app/(app)/chat/[id].tsx', 'utf8');
  const webMediaComposer = readFileSync('app/veyrnox/_components/chat/MediaComposer.js', 'utf8');
  const webEditor = readFileSync('app/veyrnox/_components/editor/GenerationPanel.js', 'utf8');
  const mobileFaceFilters = readFileSync('apps/mobile/src/components/FaceFiltersFlow.tsx', 'utf8');
  const mobileFilm = readFileSync('apps/mobile/src/lib/filmStudio.ts', 'utf8');
  const mobileFilmBreakdown = readFileSync('apps/mobile/src/components/film/FilmBreakdownStage.tsx', 'utf8');
  const mobileFilmOutput = readFileSync('apps/mobile/src/components/film/FilmPromptOutput.tsx', 'utf8');
  const mobileFilmPrompts = readFileSync('apps/mobile/src/components/film/FilmPromptsStage.tsx', 'utf8');
  const webFilmPrompts = readFileSync('app/veyrnox/_components/film/FilmPrompts.js', 'utf8');
  const mcpRoute = readFileSync('app/api/v1/mcp/route.js', 'utf8');
  const webCreate = readFileSync('app/veyrnox/app/create/page.js', 'utf8');
  const webTemplate = readFileSync('app/veyrnox/_components/TemplateRecipe.js', 'utf8');
  const priceSlip = readFileSync('app/veyrnox/_components/PriceSlip.js', 'utf8');
  assert.match(api, /prompt: \{ kind: 'string', max: GENERATION_PROMPT_MAX \}/);
  assert.match(api, /const MAX_INPUTS_BYTES = 256 \* 1024/);
  assert.match(api, /const MAX_NON_PROMPT_INPUTS_BYTES = 8 \* 1024/);
  assert.match(api, /nonPromptInputs[\s\S]*MAX_NON_PROMPT_INPUTS_BYTES/);
  assert.match(api, /const MAX_REQUEST_BYTES = 512 \* 1024/);
  assert.match(mcp, /prompt: z\.string\(\)\.min\(1\)\.max\(GENERATION_PROMPT_MAX\)/);
  assert.match(mobile, /GENERATION_PROMPT_MAX = 30_000/);
  assert.doesNotMatch(mobileCreate, /presetPrompt\.slice\(0, (?:2000|4000|GENERATION_PROMPT_MAX)\)/);
  assert.doesNotMatch(mobileCreate, /maxLength=\{text_\.max\}/);
  assert.match(mobileCreate, /promptTooLong[\s\S]*public\.TemplateRecipe\.promptTooLong/);
  assert.doesNotMatch(webCreate, /maxLength=\{isShort \? 200/);
  assert.match(webCreate, /const preparedPromptLength/);
  assert.match(webCreate, /public\.TemplateRecipe\.(?:topicTooLong|promptTooLong|productPromptTooLong)/);
  assert.doesNotMatch(priceSlip, /maxLength=\{promptLimit\}/);
  assert.match(priceSlip, /const promptTooLong/);
  assert.match(priceSlip, /public\.TemplateRecipe\.promptTooLong/);
  assert.doesNotMatch(webTemplate, /maxLength=/);
  assert.doesNotMatch(mobileTemplate, /maxLength=/);
  assert.match(webTemplate, /sourcePromptModelLimitCopyOnly/);
  assert.match(mobileTemplate, /sourcePromptModelLimitCopyOnly/);
  assert.doesNotMatch(mobileMake, /prompt\.trim\(\)\.slice|<TextField[^>]*maxLength=/);
  assert.match(mobileMake, /const promptTooLong/);
  assert.match(mobileMake, /public\.TemplateRecipe\.promptTooLong/);
  assert.doesNotMatch(mobileChat, /initialPrompt=\{draft\.trim\(\)\.slice/);
  for (const source of [webMediaComposer, webEditor, mobileFaceFilters]) assert.doesNotMatch(source, /maxLength=\{(?:model\?\.promptMax|textInput\(model\)\?\.max)/);
  assert.ok([webMediaComposer, webEditor, mobileFaceFilters].every((source) => source.includes('promptTooLong')));
  assert.match(mobileFilm, /\['script', 'content'\]\.includes\(key\) \? GENERATION_PROMPT_MAX/);
  assert.match(mobileFilmBreakdown, /maxLength=\{GENERATION_PROMPT_MAX\}/);
  assert.match(mobileFilmOutput, /maxLength = 24_000/);
  assert.match(mobileFilmPrompts, /maxLength=\{GENERATION_PROMPT_MAX\}/);
  assert.match(webFilmPrompts, /maxLength=\{FILM_SCRIPT_MAX\}/);
  assert.match(mcpRoute, /maxRequestBodySize: 512 \* 1024/);
});

test('database admission and dispatch storage use the same 256 KiB prompt envelope', () => {
  const migration = readFileSync('packages/db/schema/supabase/0406_generation_prompt_payload_bounds.sql', 'utf8');
  assert.match(migration, /fal_dispatch_payload_check[\s\S]*262144/);
  assert.match(migration, /admit_fal_dispatch[\s\S]*replace\(definition, '16384', '262144'\)/);
  assert.match(migration, /provider_spend_admit_model[\s\S]*replace\(definition, '16384', '262144'\)/);
  assert.equal((migration.match(/ELSIF position\('262144' IN definition\) = 0/g) || []).length, 2, 're-applying 0406 accepts the already widened functions');
});

test('handoffs reject an over-limit prompt instead of silently shortening it', () => {
  const tooLong = 'x'.repeat(GENERATION_PROMPT_MAX + 1);
  assert.equal(cleanCreateDraft({ modelId: 'model', prompt: tooLong }), null);
  assert.equal(filmStarterForTemplate({ id: 'template', name: 'Template', model: 'Model' }, tooLong).prompt, '');
  assert.equal(writeStudioDraft(memoryStorage(), { model: 'model', prompt: tooLong }), false);
});

test('direct Create handoff refuses an exact prompt whose reference contract is unsupported', () => {
  const seedance = ALL_TEMPLATES.find((item) => item.id === 'seedance-syntx-birthday-morning');
  assert.equal(seedance.promptOrigin, 'community-source-exact');
  assert.equal(draftForTemplate(seedance, modelIdForName(seedance.model)), null);
  const adapted = ALL_TEMPLATES.find((item) => item.id === 'event-character-swap');
  const exact = { ...adapted, prompt: sourceRecords[adapted.id].prompt, sourcePromptOrigin: 'community-source-exact', sourcePromptRunnable: false };
  assert.equal(draftForTemplate(exact, modelIdForName(exact.model)), null);
});
