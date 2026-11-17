import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import english from '../lib/i18n/messages/app/en.mjs';
import { appFiles, candidates } from '../scripts/audit-public-i18n.mjs';
import { BEAT_TEMPLATES } from '../app/veyrnox/_lib/music/beat/beatTemplates.mjs';
import { BEAT_SHORTCUTS } from '../app/veyrnox/_lib/music/beat/beatShortcuts.mjs';
import * as coach from '../app/veyrnox/_lib/music/beat/beatCoachMarks.mjs';
import * as shortcuts from '../app/veyrnox/_lib/music/beat/beatShortcuts.mjs';
import * as translate from '../lib/i18n/translate.mjs';
import * as locales from '../lib/i18n/locales.mjs';
import * as localeCookie from '../lib/i18n/localeCookie.mjs';
const require = createRequire(import.meta.url);
function load(file, stubs) {
  const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(id => stubs[id] || require(id), module, module.exports);
  return module.exports;
}
test('every literal beat key and data-driven template/shortcut key has English copy', () => {
  const keys = [...BEAT_TEMPLATES.flatMap(t => [t.nameKey, t.descriptionKey]), ...BEAT_SHORTCUTS.map(s => s.labelKey)];
  for (const dir of ['app/veyrnox/_components/music/beat', 'app/veyrnox/_lib/music/beat']) for (const file of readdirSync(dir)) {
    const text = readFileSync(`${dir}/${file}`, 'utf8');
    keys.push(...[...text.matchAll(/['"](app\.music\.beat\.[^'"`]+)['"]/g)].map(match => match[1]));
  }
  for (const key of keys) {
    if (['app.music.beat.time.bars', 'app.music.beat.time.beats', 'app.music.beat.recovery.fullLoops', 'app.music.beat.recovery.midiTracks'].includes(key)) {
      for (const form of ['one', 'other']) assert.equal(typeof english[`${key}.${form}`], 'string', `${key}.${form}`);
    } else assert.equal(typeof english[key], 'string', key);
  }
});
test('audit inventories dynamically loaded beat screens, hooks and display modules and catches untranslated fixture copy', () => {
  const inventory = appFiles();
  for (const file of ['_components/music/beat/BeatEditor.jsx', '_components/music/beat/BeatsHome.jsx', '_components/music/beat/useBeatProject.js', '_lib/music/beat/beatMessages.mjs']) assert.ok(inventory.includes(`app/veyrnox/${file}`), file);
  assert.ok(candidates('app/veyrnox/_components/music/beat/BeatFixture.jsx', 'export default function Fixture() { return <p>Untranslated beat fixture</p>; }', { app: true }).some(row => row.status === 'unresolved' && row.text === 'Untranslated beat fixture'));
});
for (const locale of ['es', 'ar']) test(`new beat UI renders through I18nProvider in ${locale}`, async () => {
  const { default: messages } = await import(`../lib/i18n/messages/app/${locale}.mjs`);
  const provider = load('components/I18nProvider.jsx', { '../lib/i18n/translate.mjs': translate, '../lib/i18n/locales.mjs': locales, '../lib/i18n/localeCookie.mjs': localeCookie });
  const stubs = { '../../../../../components/I18nProvider': provider, './beatStyles': {},
    '../../../_lib/music/beat/beatTemplates.mjs': { BEAT_TEMPLATES }, '../../../_lib/music/beat/beatShortcuts.mjs': shortcuts, '../../../_lib/music/beat/beatCoachMarks.mjs': coach };
  for (const [name, props, key] of [
    ['BeatTemplatePicker', { choose() {} }, 'app.music.beat.template.blank.description'],
    ['BeatShortcutSheet', { open: false, close() {}, replayTips() {} }, 'app.music.beat.shortcut.scope'],
    ['BeatCoachTip', { step: { index: 0, box: { top: 10, left: 10, width: 100, height: 44 } }, onNext() {}, onSkip() {} }, 'app.music.beat.tip.grid'],
  ]) {
    const Component = load(`app/veyrnox/_components/music/beat/${name}.jsx`, stubs).default;
    const html = renderToStaticMarkup(React.createElement(provider.I18nProvider, { locale, enabled: true, messages }, React.createElement(Component, props)));
    assert.doesNotMatch(html, /app\.music\.beat\./);
    if (key) { assert.ok(html.includes(messages[key])); assert.ok(!html.includes(english[key])); }
  }
});
