import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as React from 'react';
import { fixture } from './helpers/publicSiteRender.mjs';
import { CATALOGS, translator, pluralKey } from '../lib/i18n/translate.mjs';
import { localeTag } from '../lib/i18n/locales.mjs';

// Parse SSR markup structurally; these hook queries never use translated text.
function findByHook(html, selector) {
  const [, name, value] = selector.match(/^\[([\w-]+)(?:="([^"]+)")?\]$/);
  const tree = ts.createSourceFile('render.jsx', `<>${html}</>`, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const found = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attribute = node.attributes.properties.find(p => p.name?.text === name);
      if (attribute && (value === undefined || attribute.initializer?.text === value)) found.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}

test('offline SSR: Arabic and German notices and walkthrough are discoverable by stable hooks', () => {
  for (const locale of ['ar', 'de']) {
    for (const [file, component, states, props, selector, labelKey, button] of [
      ['app/veyrnox/_components/SiteChrome.js', 'StorageNotice', [], {}, '[data-storage-notice="essential"]', 'chrome.storageLabel', '[data-storage-dismiss]'],
      ['components/PostHogManager.jsx', 'default', [null, false], {}, '[data-storage-notice="analytics"]', 'privacy.choices', '[data-storage-decline]'],
      ['app/veyrnox/_components/VeyTaskGuide.jsx', 'default', [true], { visible: true, pathname: '/', panelSide: 'left' }, '[data-vey-walkthrough]', 'public.vey.walkthrough'],
    ]) {
      const f = fixture(locale, '/', { states: { [file]: states }, expose: component === 'StorageNotice' ? { [file]: [component] } : {} });
      const html = f.render(React.createElement(f.load(file)[component], props));
      const nodes = findByHook(html, selector);
      assert.equal(nodes.length, 1, `${locale}: ${file}`);
      assert.equal(nodes[0].attributes.properties.find(p => p.name?.text === 'aria-label').initializer.text, CATALOGS[locale][labelKey]);
      if (button) assert.equal(findByHook(html, button).length, 1);
    }
  }
});

test('runtime and generic E2E consumers use hooks, never translated notice/walkthrough names', () => {
  const files = ['app/reticle-dev.jsx', 'app/veyrnox/_lib/useVeyPointer.js', 'app/veyrnox/_lib/useVeyMobileLayout.js', 'e2e/page-coverage.spec.mjs', 'e2e/fixtures/authenticated-product.mjs'];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /(?:aria-label=|name: )['"](?:Browser storage notice|Privacy choices|Vey task walkthrough|Decline|Got it)/, file);
    assert.match(source, /data-(?:storage-notice|vey-walkthrough)/, file);
  }
});

test('shared locale mapping preserves original English browser defaults and explicit en-GB', () => {
  assert.equal(localeTag('en'), undefined);
  assert.equal(localeTag('en', 'en-GB'), 'en-GB');
  assert.equal(localeTag('en', 'en'), 'en');
  assert.equal(localeTag('zh'), 'zh-CN');
  assert.equal(localeTag('pt'), 'pt-BR');
  for (const locale of ['es', 'hi', 'ar', 'fr', 'ru', 'ja', 'de', 'ko']) assert.equal(localeTag(locale), locale);
  const date = new Date('2026-10-18T13:45:00Z');
  assert.equal(date.toLocaleString(localeTag('en')), date.toLocaleString());
  assert.equal(new Intl.DateTimeFormat(localeTag('en'), { dateStyle: 'short', timeStyle: 'short' }).format(date), new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(date));
  assert.equal((1500).toLocaleString(localeTag('en')), (1500).toLocaleString());
});

test('offline SSR: English Winners and Pass dates exactly match their origin/main formatters', () => {
  const iso = '2026-10-18T13:45:00Z';
  const winner = { id: 'week', name: 'Catalog week', ends_at: iso, titles: [] };
  const winnersFile = 'app/veyrnox/social-cinema/CinemaWinners.js';
  const winners = fixture('en', '/social-cinema', { states: { [winnersFile]: ['ready', [winner], 0] } });
  const winnersHtml = winners.render(React.createElement(winners.load(winnersFile).CinemaWinners));
  // Exact format expressions from origin/main, including the Winners timezone.
  assert.ok(winnersHtml.includes(new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/London' })));
  const passFile = 'app/veyrnox/social-cinema/pass/PassPanel.js';
  const pass = { status: 'active', current_period_end: iso, price_usd_cents: 500 };
  const panel = fixture('en', '/social-cinema/pass', { states: { [passFile]: [null, null, pass] }, expose: { [passFile]: ['Pass'] } });
  const passHtml = panel.render(React.createElement(panel.load(passFile).Pass, { salesOpen: true }));
  assert.ok(passHtml.includes(new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })));
});

test('all changed date/number call sites retain their English locale argument', () => {
  const calls = [
    ...['CinemaComments', 'CinemaDiscovery', 'CinemaVoting', 'CinemaStoryPolls'].map(name => [`app/veyrnox/social-cinema/${name}.js`, '.toLocaleString(localeTag(locale))']),
    ['app/social/review/[token]/page.js', '.toLocaleString(localeTag(locale))'],
    ['app/social/team/invite/[token]/page.js', '.toLocaleString(localeTag(locale))'],
    ['app/veyrnox/_components/CreditSubscriptions.js', 'p.credits.toLocaleString(localeTag(locale))'],
    ['app/veyrnox/_components/VeyConversation.jsx', 'new Intl.DateTimeFormat(localeTag(locale),'],
    ['app/veyrnox/social-cinema/CinemaWinners.js', "toLocaleDateString(localeTag(locale, 'en-GB'),"],
    ['app/veyrnox/social-cinema/pass/PassPanel.js', "toLocaleDateString(localeTag(locale, 'en-GB'),"],
  ];
  for (const [file, call] of calls) assert.ok(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').includes(call), file);
});

const categories = ['zero', 'one', 'two', 'few', 'many', 'other'];
const pluralFamilies = ['cinema.polls.answers', 'cinema.creator.refunded', 'search.count', 'model.credits'];
test('all catalogs include every supported plural form and the independent AuthGate title', () => {
  for (const [locale, messages] of Object.entries(CATALOGS)) {
    for (const family of pluralFamilies) for (const category of categories) assert.equal(typeof messages[`${family}.${category}`], 'string', `${locale}: ${family}.${category}`);
    assert.equal(messages['authGate.title'], messages['mcp.s2.title']);
    assert.equal(messages['cinema.polls.answers'], undefined);
    assert.equal(messages['cinema.creator.refunded'], undefined);
  }
  const t = translator('en');
  for (const count of [0, 1, 2]) {
    const expected = count === 1 ? 'one' : 'other';
    for (const family of pluralFamilies) assert.equal(pluralKey(t, 'en', family, count), `${family}.${expected}`);
  }
  const partial = { messages: { 'family.other': '{count}' } };
  assert.equal(pluralKey(partial, 'ar', 'family', 2), 'family.other');
});

test('offline SSR: English, Arabic and Russian poll plurals keep the test hook on the number only', () => {
  const file = 'app/veyrnox/social-cinema/CinemaStoryPolls.js';
  const cases = { en: [[0, 'other'], [1, 'one'], [2, 'other']], ar: [[0, 'zero'], [1, 'one'], [2, 'two'], [3, 'few'], [11, 'many'], [100, 'other']], ru: [[1, 'one'], [2, 'few'], [5, 'many'], [21, 'one'], [22, 'few'], [25, 'many'], [1.5, 'other']] };
  for (const [locale, samples] of Object.entries(cases)) for (const [count, category] of samples) {
    const poll = { id: 'poll', question: 'Catalog question', closes_at: '2026-10-18T13:45:00Z', is_open: true, options: [{ id: 'answer', label: 'Catalog answer', votes: count }] };
    const f = fixture(locale, '/social-cinema', { states: { [file]: [{ polls: [poll] }] }, expose: { [file]: ['Polls'] } });
    const html = f.render(React.createElement(f.load(file).Polls, { contentId: 'title', account: null }));
    const match = html.match(/<span data-testid="story-choice-count-answer">([^<]*)<\/span>/);
    assert.equal(match?.[1], String(count), `${locale}/${count}`);
    const plain = html.replace(/<[^>]+>/g, '');
    assert.ok(plain.includes(translator(locale)(`cinema.polls.answers.${category}`, { count })), `${locale}/${count}`);
    if (locale === 'en') assert.ok(plain.includes(`${count} counted ${count === 1 ? 'answer' : 'answers'}`));
    for (const family of pluralFamilies) assert.equal(pluralKey(translator(locale), locale, family, count), `${family}.${category}`);
  }
});

test('offline SSR: AuthGate uses its own translated title in English, German and Arabic', () => {
  const file = 'components/AuthGate.jsx';
  assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), /mcp\.s2\.title/);
  for (const locale of ['en', 'de', 'ar']) {
    const f = fixture(locale, '/', { states: { [file]: [true] } });
    const html = f.render(React.createElement(f.load(file).default));
    assert.ok(html.includes(`aria-label="${CATALOGS[locale]['authGate.title']}"`));
    assert.ok(html.includes(`>${CATALOGS[locale]['authGate.title']}</h2>`));
  }
});
