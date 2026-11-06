import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { templateDetail } from '../lib/clientTemplates.js';
import { ALL_TEMPLATES } from '../app/veyrnox/_lib/templates.js';
import { templateSourceUnsupported } from '../app/veyrnox/_lib/templateSourceBlock.js';

test('rap-takeover points at @video1, which Veyrnox cannot supply: it is inspiration only', () => {
  const detail = templateDetail('rap-takeover');
  assert.ok(detail.sourcePromptIssues.includes('reference-video-not-supported'));
  assert.equal(templateSourceUnsupported(detail), true);
});

test('a template that only needs the person\'s photo is not blocked', () => {
  const photoOnly = ALL_TEMPLATES.map(p => templateDetail(p.id))
    .find(d => d?.sourcePromptOrigin === 'community-source-exact' && d.sourcePromptIssues?.includes('reference-image-input-required')
      && !d.sourcePromptIssues.includes('reference-video-not-supported') && !d.sourcePromptIssues.includes('audio-preservation-not-supported'));
  assert.ok(photoOnly, 'a photo-only exact template exists');
  assert.equal(templateSourceUnsupported(photoOnly), false);
  assert.equal(templateSourceUnsupported(null), false);
  assert.equal(templateSourceUnsupported({ sourcePromptOrigin: null, sourcePromptIssues: ['reference-video-not-supported'] }), false, 'only the exact community prompt is judged');
});

test('the recipe, the template page and Create all stop generation for it', () => {
  const recipe = readFileSync(new URL('../app/veyrnox/_components/TemplateRecipe.js', import.meta.url), 'utf8');
  assert.match(recipe, /templateSourceUnsupported\(preset\)/);
  assert.match(recipe, /generationBlocked=\{sourceUnsupported \|\| undefined\}/);
  assert.match(recipe, /public\.TemplateRecipe\.sourceVideoUnsupported/);
  const create = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');
  assert.match(create, /const sourceBlocked = !!activeTemplate && templateSourceUnsupported\(activeTemplate\) && prompt === activeTemplate\.prompt;/);
  assert.match(create, /if \(catalogStatus !== 'live' \|\| sourceBlocked\) return;/, 'onSubmit refuses');
  assert.match(create, /\(!hasJobs && \(catalogStatus !== 'live' \|\| sourceBlocked/, 'the button is disabled');
});
