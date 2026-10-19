import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { translator } from '../lib/i18n/translate.mjs';
import { localeTag, LOCALES } from '../lib/i18n/locales.mjs';
import { HELPER_MESSAGES } from '../lib/helperMessageDefinitions.mjs';
import { helperMessage, helperDiagnostic, helperEnglish } from '../lib/helperMessages.mjs';
import { helperCopy } from '../lib/i18n/helperCopy.mjs';
import { fixture } from './helpers/publicSiteRender.mjs';
import { renderScenario, scenarios } from './helpers/appI18nRound5.mjs';
import { emptySequence } from '../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequenceDiagnostic } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { validateTimeline } from '../app/veyrnox/_lib/editorTimeline.mjs';
import { animationSelectionProblemDiagnostic } from '../app/veyrnox/_lib/editorAnimationCatalog.mjs';
import { filterSelectionProblemDiagnostic } from '../app/veyrnox/_lib/editorFilters.mjs';
import { checkProbe } from '../app/veyrnox/_lib/editorMedia.mjs';
import { validateMotionOptions } from '../app/veyrnox/_lib/editorMotionProcessing.mjs';
import { personLightProblem } from '../app/veyrnox/_lib/editorPersonLight.mjs';
import { reshapeProblem } from '../app/veyrnox/_lib/editorPersonGeometry.mjs';
import { validateVisionSettings } from '../app/veyrnox/_lib/editorVisionPixelProcessing.mjs';
import { checkSceneBounds } from '../app/veyrnox/_lib/editorSceneRun.mjs';
import { validateVideo } from '../app/veyrnox/_lib/videoEnhance.mjs';
import { assetPackProblem } from '../app/veyrnox/_lib/editorAssetPacks.mjs';
import { brandKitProblem } from '../lib/editorShared.js';
import { voiceoverProblem } from '../app/veyrnox/_lib/editorVoiceover.mjs';
import { generationFileProblem } from '../app/veyrnox/_lib/editorGenerationUploads.mjs';
import { generationPromptHelpDiagnostic } from '../app/veyrnox/_lib/editorGeneration.mjs';
import { saveProblemDiagnostic } from '../app/veyrnox/_lib/editorProject.mjs';
import { translationProblem } from '../app/veyrnox/_lib/editorTranslation.mjs';
import { planSummary, planSummaryDiagnostic } from '../app/veyrnox/_lib/editorAgentPlan.mjs';
import { savedOddlingHelp } from '../lib/savedOddlingHelp.js';
import { ODDLING_LIBRARY_KEY } from '../app/veyrnox/_lib/oddlingStudio.js';
import { publicHelpHistory } from '../lib/savedOddlingHelp.js';

const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');
const snapshot = JSON.parse(readFileSync('tests/fixtures/app-helper-english-22945bc0.json', 'utf8'));
const paramsFor = code => code === 'clips_length'
  ? { value1: 2, value2: 'steps', value3: 4, value4: 3, value5: '', value6: -1, value7: '0:04.0', value8: '0:03.0' }
  : code === 'too_many_clips' ? { value1: 'video' }
  : code === 'passport_summary' ? { name: 'User {name} 123', details: 'User trait', instructions: helperEnglish('passport_open'), animation: '' }
  : { value1: 37, reason: helperEnglish('invalid_multitrack_document') };

// Every source family uses the same alert display boundary in the editor. Exercise
// each code through that actual React boundary, not only a catalog lookup.
for (const locale of ['en', 'de', 'ja', 'ar']) test(`helper display codes render in ${locale}, including every helper family`, async () => {
  const messages = await appMessagesFor(locale), t = translator(locale, messages);
  const f = fixture(locale, '/app/editor', { messages });
  const { HelperNotice } = f.load('components/HelperNotice.jsx');
  for (const code of Object.keys(HELPER_MESSAGES)) {
    const diagnostic = helperMessage(code, paramsFor(code));
    const text = helperCopy(t, locale, diagnostic);
    const html = f.render(React.createElement(HelperNotice, { message: diagnostic }));
    assert.ok(html.includes(escape(text)), code);
    if (locale === 'en') assert.equal(text, diagnostic.message, code);
    else if (!['video', 'audio', 'text'].includes(code)) assert.notEqual(text, diagnostic.message, code);
    assert.doesNotMatch(text, /app\.helpers\.|\{(?:limit\w*|value\d+|reason|instructions|animation)\}/, code);
  }
});

test('English helper templates match the frozen main baseline byte for byte', () => {
  assert.equal(snapshot.commit, '22945bc05d17ba1deadf0e1e05a76f4d1e21be76');
  assert.equal(snapshot.rows.length, 214);
  for (const { code, english } of snapshot.rows) assert.equal(HELPER_MESSAGES[code].english, english, code);
});

test('real validator failures return English defaults and code-bearing display diagnostics', async () => {
  const tl = emptySequence();
  const examples = [
    validateSequenceDiagnostic({}), validateTimeline({}), animationSelectionProblemDiagnostic(tl, null), filterSelectionProblemDiagnostic(tl, []),
    checkProbe({ kind: 'video', canDecodeVideo: false }), validateMotionOptions({}), personLightProblem({}), reshapeProblem({}), validateVisionSettings({}),
    checkSceneBounds(null, null), validateVideo(null), assetPackProblem(null), brandKitProblem(null), voiceoverProblem({ name: 'NotAllowedError' }),
    generationFileProblem('image', null), generationPromptHelpDiagnostic({ isSpeech: true, promptMax: 1234 }), saveProblemDiagnostic({ status: 409 }), translationProblem([], '', ''),
  ];
  for (const locale of ['en', 'de', 'ja', 'ar']) {
    const messages = await appMessagesFor(locale), t = translator(locale, messages);
    const f = fixture(locale, '/app/editor', { messages }), { HelperNotice } = f.load('components/HelperNotice.jsx');
    for (const value of examples) {
      const diagnostic = helperDiagnostic(value);
      assert.ok(diagnostic?.code, JSON.stringify(value));
      const html = f.render(React.createElement(HelperNotice, { message: diagnostic }));
      assert.ok(html.includes(escape(helperCopy(t, locale, diagnostic))));
      if (locale === 'en') assert.ok(html.includes(escape(diagnostic.message)));
      else assert.ok(!html.includes(escape(diagnostic.message)));
    }
  }
});

test('limits and numeric parameters survive every language, with English spelling preserved', async () => {
  for (const { code: locale } of LOCALES) {
    const t = translator(locale, await appMessagesFor(locale));
    for (const [code, definition] of Object.entries(HELPER_MESSAGES)) {
      const message = helperMessage(code, paramsFor(code)), displayed = helperCopy(t, locale, message);
      for (const [slot, raw] of Object.entries(definition.defaults)) {
        const number = { four: 4, eight: 8 }[raw] ?? Number(raw.replaceAll(',', '').replace('−', '-'));
        const expected = locale === 'en' ? raw : new Intl.NumberFormat(localeTag(locale), { maximumFractionDigits: 10 }).format(number);
        assert.ok(displayed.includes(expected), `${locale}/${code}/${slot}: ${displayed}`);
      }
    }
  }
});

test('effect and preset descriptions render translated while selection ids stay English', async () => {
  for (const locale of ['en', 'de', 'ja', 'ar']) {
    const messages = await appMessagesFor(locale), t = translator(locale, messages);
    for (const [panel, code] of [['Effects', 'darken_the_frame_edges'], ['Templates', 'a_clean_animated_opening_title']]) {
      const scenario = scenarios.find(s => s.area === 'catalog' && s.props?.panel === panel && !s.states);
      const html = renderScenario(scenario, locale, messages);
      assert.ok(html.includes(escape(helperCopy(t, locale, helperMessage(code)))), `${locale}/${panel}`);
    }
  }
});

test('plan summary translates complete diagnostics without altering plan data or timecodes', async () => {
  const result = { ok: true, steps: [{ index: 0 }], before: { clips: 4, end: 120 }, after: { clips: 3, end: 90 } };
  const before = JSON.stringify(result), diagnostic = planSummaryDiagnostic(result);
  assert.equal(diagnostic.message, planSummary(result));
  for (const locale of ['de', 'ja', 'ar']) {
    const text = helperCopy(translator(locale, await appMessagesFor(locale)), locale, diagnostic);
    assert.doesNotMatch(text, /steps?|app\.helpers/);
    assert.match(text, /0:04\.0/); assert.match(text, /0:03\.0/);
  }
  assert.equal(JSON.stringify(result), before);
});

test('saved passport responses translate at VeyConversation while user data and canonical history stay unchanged', async () => {
  const item = { id: 'saved-test', savedAt: 1720000000000, picks: { oddling_name: 'User 123', oddling_obsession: 'My personal premise' } };
  const storage = { getItem: key => key === ODDLING_LIBRARY_KEY ? JSON.stringify([item]) : null };
  const plan = savedOddlingHelp('my saved passport', storage, { selectedId: 'saved-test' });
  assert.equal(plan.code, 'passport_summary');
  const history = [{ id: 'response', role: 'assistant', content: plan.message, diagnostic: plan, localOnly: true }];
  assert.deepEqual(publicHelpHistory(history), []);
  for (const locale of ['en', 'de', 'ja', 'ar']) {
    const messages = await appMessagesFor(locale), f = fixture(locale, '/app', { messages });
    const Conversation = f.load('app/veyrnox/_components/VeyConversation.jsx').default;
    const html = f.render(React.createElement(Conversation, { messages: history, plan, starters: [] }));
    assert.match(html, /User 123/); assert.match(html, /My personal premise/);
    if (locale === 'en') assert.ok(html.includes(escape(plan.message)));
    else { assert.doesNotMatch(html, /saved passport|Open this saved passport in History/); }
  }
});

test('unknown messages and missing catalogs preserve the exact fallback, including braces', () => {
  const t = translator('de', {});
  assert.equal(helperCopy(t, 'de', 'Provider {literal} 123'), 'Provider {literal} 123');
  const message = helperMessage('passport_summary', { name: '{name}', details: 'User details', instructions: '', animation: '' });
  assert.equal(helperCopy(t, 'de', message), message.message);
});

test('all helper display consumers remain wired, without translated selectors or stored values', () => {
  for (const name of ['AnimationCatalogPanel', 'AssetPackPanel', 'BrandKitPanel', 'CatalogPanel', 'ExportPanel', 'FilterPanel', 'GenerationPanel', 'ProjectBar', 'ProjectFileControls', 'ReviewWorkspace', 'ScenesPanel']) {
    assert.match(readFileSync(`app/veyrnox/_components/editor/${name}.js`, 'utf8'), /helperCopy\(t, locale, /, name);
  }
  for (const file of ['app/veyrnox/_components/editor/MultitrackWorkspace.js', 'app/veyrnox/app/editor/page.js']) assert.match(readFileSync(file, 'utf8'), /<HelperNotice message=\{notice\}/);
  assert.doesNotMatch(readFileSync('lib/helperMessages.mjs', 'utf8'), /document\.cookie|useI18n|from .*i18n/);
});

test('unused token card prices are pinned to numbers extracted from the English baseline', async () => {
  const { FEATURE_CARDS } = await import('../app/veyrnox/_lib/tokens.js');
  const numbers = text => text.match(/\d+(?:[.,]\d+)*/g) || [];
  assert.equal(snapshot.tokenCards.length, 5);
  for (const { key, body } of snapshot.tokenCards) {
    const current = FEATURE_CARDS.find(card => card.key === key);
    assert.equal(current.body, body, key);
    assert.deepEqual(numbers(current.body), numbers(body), key);
  }
  // The legacy bodies have no display site. Price rendering still uses live
  // catalog credits, not the old 2 / 1 / 19 / 17-credit marketing values.
  const hero = readFileSync('app/veyrnox/_sections/hero.js', 'utf8');
  assert.doesNotMatch(hero, /\bf\.body\b/);
  assert.match(hero, /row\.credits/);
});
