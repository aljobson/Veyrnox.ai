import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEGAL_DOCUMENTS, legalDocument } from '../lib/i18n/legal/catalogs.mjs';
import { BINDINGS, LEGAL_CHROME } from '../lib/i18n/legal/binding.mjs';
import { checkSources, currentSources, assertCurrentSources, hashText, STALE_MESSAGE } from '../scripts/legal-source-hashes.mjs';
import { candidates } from '../scripts/audit-public-i18n.mjs';
import { fixture } from './helpers/publicSiteRender.mjs';

const forms = { en: '2,000', de: '2.000', pt: '2.000', es: '2000', fr: '2\u202f000', ru: '2\u00a0000', ar: '2\u066c000', zh: '2,000', ja: '2,000', ko: '2,000', hi: '2,000' };

test('all legal documents, binding and chrome contain only the reviewed grouped number', async () => {
  for (const [code, form] of Object.entries(forms)) {
    const found = [];
    for (const area of [...LEGAL_DOCUMENTS, 'binding', 'chrome']) {
      const messages = area === 'binding' ? BINDINGS[code] : area === 'chrome' ? LEGAL_CHROME[code] : (await legalDocument(code, area)).messages;
      for (const [key, value] of Object.entries(messages)) {
        const groups = value.match(/[0-9٠-٩०-९]+(?:[,. \u00a0\u202f\u066c][0-9٠-٩०-९]{3})+/g) || [];
        for (const group of groups) found.push([area, key, group]);
        if (['de', 'es', 'fr', 'pt', 'ru'].includes(code)) assert.ok(!value.includes('2,000'), `${code}/${area}/${key}`);
      }
    }
    assert.deepEqual(found, code === 'es' ? [] : [['terms', 'b014', form]], code);
    assert.ok((await legalDocument(code, 'terms')).messages.b014.includes(form), code);
  }
});

test('Terms quote the checkout source verbatim and isolate its language and direction', async () => {
  for (const code of Object.keys(BINDINGS)) {
    const { messages } = await legalDocument(code, 'terms');
    assert.ok(messages.b016.includes(BINDINGS.en.supply), code);
    if (code !== 'en') {
      assert.ok(!messages.b016.includes(BINDINGS[code].supply), 'No drifting translated quotation');
      const f = fixture(code, '/legal/terms', { moduleMocks: {
        '../../veyrnox/layout': { __esModule: true, default: () => null },
      } });
      const { LegalBlocks } = f.load('app/legal/_lib/LegalDocument.js');
      const html = f.render(LegalBlocks({ blocks: [{ tag: 'p', key: 'b016' }], messages, locale: code }));
      assert.ok(html.includes(`<span lang="en" dir="ltr">${BINDINGS.en.supply}</span>`), code);
    }
  }
});

test('all exact English binding quotations in documents are covered by Terms b016', async () => {
  const quotations = [];
  for (const document of LEGAL_DOCUMENTS) {
    for (const [key, value] of Object.entries((await legalDocument('en', document)).messages)) {
      for (const [id, binding] of Object.entries(BINDINGS.en)) {
        if (!id.includes('.') && value.includes(binding)) quotations.push([document, key, id]);
      }
    }
  }
  assert.deepEqual(quotations, [['terms', 'b016', 'supply']]);
});

test('English source manifest is current, including document review dates and anchors', checkSources);

test('wording, keys, dates, bindings, chrome and anchors cannot change without confirmation', async () => {
  const original = await currentSources();
  const mutations = [
    current => { current.documents.terms.hashes.b003 = hashText('Changed without any digits'); },
    current => { current.documents.terms.translationsReviewedAgainstEnglishDated = '20 October 2026'; },
    current => { delete current.documents.terms.hashes.b003; },
    current => { current.documents.terms.hashes.newKey = hashText('A new obligation'); },
    current => { current.binding.supply = hashText('A differently worded consent'); },
    current => { current.chrome.notice = hashText('A different notice'); },
    current => { current.anchors.sourceRights[0].href = '/changed'; },
    current => { current.anchors.sourceRights[0].text = 'Changed label'; },
  ];
  for (const mutate of mutations) {
    const current = structuredClone(original);
    mutate(current);
    assert.throws(() => assertCurrentSources(original, current), error => error.message.startsWith(STALE_MESSAGE));
  }
});

test('binding audit refuses changed English anchor destinations or text', () => {
  for (const [file, text] of [
    ['app/veyrnox/_components/SourceRightsConfirmation.jsx', 'Acceptable Use'],
    ['app/veyrnox/_components/chat/MediaComposer.js', 'Acceptable Use Policy'],
    ['app/veyrnox/_components/editor/GenerationPanel.js', 'Acceptable Use'],
    ['app/veyrnox/social-cinema/creator/CreatorWorkspace.js', 'Cinema Content Policy'],
    ['app/veyrnox/_components/TopUpPacks.js', 'Refund policy'],
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.ok(candidates(file, source).some(row => row.kind === 'binding' && row.status === 'translated'), file);
    for (const changed of [source.replace(/href="\/legal\/[^"]+"/, 'href="/changed"'), source.replace(`>${text}<`, '>Changed label<')]) {
      assert.notEqual(changed, source);
      assert.ok(candidates(file, changed).some(row => row.kind === 'binding' && row.status === 'unresolved'), file);
    }
  }
});

test('hard-wall scope includes legal structures and every message catalog, and skips binaries', () => {
  const script = readFileSync('scripts/check-hard-wall.sh', 'utf8');
  const scope = script.match(/SCOPE=\(([\s\S]*?)\)/)[1];
  for (const dir of ['lib/i18n/legal', 'lib/i18n/messages/legal', 'lib/i18n/messages']) assert.ok(scope.includes(`'${dir}'`));
  assert.match(script, /grep -[A-Za-z]*I[A-Za-z]* /);
});
