// Navigation presents two editors, Smart Cut and Professional.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { studioSidebarSections, studioMenuItems } from '../app/veyrnox/_lib/studioNavigation.js';
import en from '../lib/i18n/messages/app/en.mjs';

const t = Object.assign((key) => en[key] ?? key, { label: (name) => name });
const flags = { projects: true, publish: true, enhance: true, editor: true };
const tools = () => studioSidebarSections(t, flags).find((s) => s.id === 'tools').items;

test('the sidebar names both editors with a one-line description', () => {
  const items = tools();
  const smart = items.find((i) => i.key === 'smartCut');
  const pro = items.find((i) => i.key === 'editor');
  assert.equal(smart.label, 'Smart Cut');
  assert.equal(smart.hint, 'Pick clips, it cuts pauses and ums');
  assert.equal(smart.href, '/app/library#smart-cut');
  assert.equal(pro.label, 'Professional');
  assert.equal(pro.hint, 'Full timeline editor');
  assert.equal(pro.href, '/app/editor');
  assert.ok(items.indexOf(smart) < items.indexOf(pro), 'Smart Cut sits before Professional');
});

test('the compact menu lists both editors', () => {
  const labels = studioMenuItems(t, flags).map((i) => i.label);
  assert.ok(labels.includes('Smart Cut') && labels.includes('Professional'));
});

test('Smart Cut stays listed while the timeline editor is switched off; Professional hides', () => {
  const off = studioSidebarSections(t, { ...flags, editor: false }).find((s) => s.id === 'tools').items.map((i) => i.key);
  assert.ok(off.includes('smartCut'));
  assert.ok(!off.includes('editor'));
});

test('every locale has the four new nav strings', () => {
  for (const l of ['ar', 'de', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh']) {
    const src = readFileSync(new URL(`../lib/i18n/messages/app/${l}/nav.mjs`, import.meta.url), 'utf8');
    for (const k of ['smartCut', 'smartCutHint', 'professional', 'professionalHint']) assert.match(src, new RegExp(`"app\\.nav\\.${k}"`), `${l} ${k}`);
  }
});

test('the Library reads the #smart-cut hash the nav links to', () => {
  assert.match(readFileSync(new URL('../app/veyrnox/_lib/useSmartCutIntent.js', import.meta.url), 'utf8'), /#smart-cut/);
});
