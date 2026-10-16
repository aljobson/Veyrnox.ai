import test from 'node:test';
import assert from 'node:assert/strict';
import { browserHelpPlan } from '../lib/browserHelp.js';
import { publicHelpHistory } from '../lib/savedOddlingHelp.js';
import { ODDLING_LIBRARY_KEY } from '../app/veyrnox/_lib/oddlingStudio.js';

const context = { pathname: '/app/create', task: { phase: 'video', imageId: 'chosen-image', reviewed: {} },
  view: { route: '/app/create', kind: 'video', imageRequired: true, sourceAttached: true, sourceId: 'chosen-image', cost: 34 } };
const items = ['one', 'two'].map(id => ({ id, savedAt: 1000, picks: { oddling_name: 'Max Rep', oddling_rule: `private canon ${id}` } }));
const storage = { getItem: key => key === ODDLING_LIBRARY_KEY ? JSON.stringify(items) : null, setItem: () => assert.fail('help must not write storage') };
const noLookup = { getItem: () => assert.fail('attached-image help must not look up passport versions') };

test('the exact Max Rep question prioritizes the attached image over duplicate passport names', () => {
  const q = 'How can I keep Max Rep’s face, hair and outfit consistent when animating this saved image?';
  const plan = browserHelpPlan(q, storage, context);
  assert.match(plan.message, /image already attached/);
  assert.match(plan.message, /do not need to choose a saved passport again/);
  assert.match(plan.message, /Preserve the same face, hair, physique and outfit/);
  assert.equal(plan.target, 'create.prompt');
  assert.equal(plan.localOnly, true);
  assert.equal(plan.savedChoices, undefined);
  assert.equal(plan.savedOddlingId, undefined);
  assert.doesNotMatch(plan.message, /private canon/);
  assert.deepEqual(browserHelpPlan(q, noLookup, context), plan);
});

test('explicit passport browsing, version selection and comparison still work', () => {
  for (const q of ['Show Max Rep saved passports', 'Compare Max Rep passport versions', 'Where are my saved Oddlings?']) {
    assert.equal(browserHelpPlan(q, storage, context).savedChoices.length, 2);
  }
  assert.equal(browserHelpPlan('Use this saved passport', storage, { ...context, selectedId: 'two' }).selectedSavedId, 'two');
});

test('missing, replaced and uploaded sources do not invent the tracked image identity', () => {
  const q = 'How do I animate Max Rep?';
  const missing = browserHelpPlan(q, noLookup, { ...context, view: { ...context.view, sourceAttached: false, sourceId: null } });
  assert.match(missing.message, /no start image attached now/);
  const replaced = browserHelpPlan(q, noLookup, { ...context, view: { ...context.view, sourceId: 'another-image' } });
  assert.match(replaced.message, /different from the image tracked/);
  assert.equal(replaced.target, 'create.upload');
  const upload = browserHelpPlan(q, noLookup, { ...context, task: null, view: { ...context.view, sourceId: null } });
  assert.match(upload.message, /image already attached/);
});

test('passport origin is not inferred from the attached image', () => {
  const plan = browserHelpPlan('Which Max Rep passport version was used for this attached image?', noLookup, context);
  assert.match(plan.message, /will not guess that version/);
});

test('other routes, absent sources and image creation retain saved passport help', () => {
  for (const c of [{ ...context, pathname: '/app/oddlings' }, { ...context, task: null, view: { ...context.view, sourceAttached: false, sourceId: null } }, { ...context, view: { ...context.view, kind: 'image' } }]) {
    assert.equal(browserHelpPlan('Animate Max Rep', storage, c).savedChoices.length, 2);
  }
  assert.equal(browserHelpPlan('How do I use Web search?', noLookup, context), null);
});

test('next-step guidance and source identity remain unchanged and private', () => {
  const before = JSON.stringify(context);
  assert.equal(browserHelpPlan('What is the next step in my current task?', noLookup, context).target, 'create.prompt');
  const plan = browserHelpPlan('Keep Max Rep consistent in this video', noLookup, context);
  assert.deepEqual(publicHelpHistory([{ role: 'user', content: 'Max Rep question', localOnly: true }, { role: 'assistant', content: plan.message, localOnly: plan.localOnly }]), []);
  assert.equal(JSON.stringify(context), before);
  assert.equal(plan.action, 'show_target');
});
