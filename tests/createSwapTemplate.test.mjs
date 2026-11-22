import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { swapTemplatePromptKept, swapTemplateHref } from '../app/veyrnox/_lib/createSwapTemplate.js';
import { translator } from '../lib/i18n/translate.mjs';

const swap = { id: 'community-kitchen-dance-swap', sourcePrompt: 'Change character to <<<image_1>>> scene 1980s Czechoslovakia', prompt: 'Change character to <<<image_1>>> scene 1980s Czechoslovakia' };
const page = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');

test('a swap prompt left as the template wrote it is blocked on any model; an edited prompt is a custom run', () => {
  assert.equal(swapTemplatePromptKept(swap, swap.prompt), true);
  assert.equal(swapTemplatePromptKept(swap, `  ${swap.sourcePrompt}\n`), true);
  assert.equal(swapTemplatePromptKept({ ...swap, prompt: 'A rewritten display prompt' }, swap.sourcePrompt), true);
  assert.equal(swapTemplatePromptKept(swap, 'A woman in a pink dress walks through a 1980s street'), false);
  assert.equal(swapTemplatePromptKept({ id: 'x', sourcePrompt: 'A slow pan over a beach', prompt: 'A slow pan over a beach' }, 'A slow pan over a beach'), false);
  assert.equal(swapTemplatePromptKept(null, swap.prompt), false);
});

test('Create sends a live swap template to the swap screen before it loads the normal form', () => {
  const apply = page.slice(page.indexOf('async function applyTemplate'), page.indexOf('const nextId = templateModelId(preset)'));
  assert.ok(apply.indexOf('fetchSwapAvailability(card.id)') > -1);
  assert.ok(apply.indexOf('fetchSwapAvailability(card.id)') < apply.indexOf('fetchTemplate(card.id)'));
  assert.match(apply, /router\.push\(swapTemplateHref\(card\.id\)\); return;/);
  assert.equal(swapTemplateHref('a b'), '/app/create?preset=a%20b');
});

test('the kept swap prompt reaches the Generate block, and the note names the way out', () => {
  assert.match(page, /const swapPromptKept = !swapId && swapTemplatePromptKept\(activeTemplate \|\| keptTemplate, prompt\);/);
  assert.match(page, /const templateBlocked = [^\n]*swapPromptKept/);
  assert.match(page, /if \(templateData && templateBlocked\) return;/);
  const t = translator('en');
  assert.match(t('presets.swap.createBlocked'), /can't run it/);
  assert.equal(t('presets.swap.createBlockedOpen'), 'Use the swap screen');
});
