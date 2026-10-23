import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL_TEMPLATES } from '../app/veyrnox/_lib/templates.js';
import { SHOWCASE_CLIPS } from '../app/veyrnox/_lib/showcase.js';
import { templateHandoffVisual, templateNeedsSource } from '../app/veyrnox/_lib/templateHandoff.js';
import { modelIdForName, presetHref } from '../app/veyrnox/_lib/tokens.js';

test('every template remains visibly linked from its recipe page into Create', () => {
  assert.equal(ALL_TEMPLATES.length, 164, 'audit every current template, not only gallery examples');
  for (const preset of ALL_TEMPLATES) {
    assert.match(presetHref(preset), new RegExp(`[?&]preset=${preset.id}(?:&|$)`), preset.id);
    assert.ok(modelIdForName(preset.model), `${preset.id} opens a known model`);
    const visual = templateHandoffVisual(preset);
    assert.ok(visual, `${preset.id} has a Create handoff visual`);
    if (preset.clipKey) {
      assert.equal(visual.kind, 'video', `${preset.id} keeps its exact preview`);
      assert.equal(visual.video, SHOWCASE_CLIPS[preset.clipKey].video);
      assert.equal(visual.poster, SHOWCASE_CLIPS[preset.clipKey].poster);
    } else {
      assert.equal(visual.kind, 'artwork', `${preset.id} gets a labelled artwork reference`);
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
