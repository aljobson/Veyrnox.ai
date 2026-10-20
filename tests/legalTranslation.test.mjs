import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as React from 'react';
import ts from 'typescript';
import { fixture } from './helpers/publicSiteRender.mjs';
import { LEGAL_DOCUMENTS, legalDocument } from '../lib/i18n/legal/catalogs.mjs';
import { LOCALES, localeInfo, localizedHref, languageAlternates } from '../lib/i18n/locales.mjs';
import { BINDINGS, LEGAL_CHROME } from '../lib/i18n/legal/binding.mjs';
import { candidates } from '../scripts/audit-public-i18n.mjs';

// The catalog files name the object (`const messages = { ... }`) and export it by name, so the
// anonymous-default-export lint rule stays quiet; read the keys from that declaration.
const catalogKeys = tree => tree.statements
  .find(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => declaration.name.text === 'messages'))
  .declarationList.declarations[0].initializer.properties.map(property => property.name.text);

process.env.LOCALES_ENABLED = 'true';
const moduleMocks = { '../../veyrnox/layout': { __esModule: true, default: ({ children }) => React.createElement('div', { 'data-layout': 'legal' }, children) } };
const baseline = JSON.parse(readFileSync('tests/fixtures/legal-english-main.json', 'utf8'));
const slots = text => [...text.matchAll(/\{\w+\}/g)].map(match => match[0]).sort();
export const numbers = text => {
  const latin = text.replace(/[٠-٩०-९]/g, digit => String(digit.charCodeAt(0) - (digit >= '०' ? 0x0966 : 0x0660)));
  return (latin.match(/\d+(?:[.,]\d+|[ \u00a0\u202f\u066c]\d{3}(?!\d))*(?:%|\+)?/g) || [])
    .map(number => number.replace(/(?<=\d)[,. \u00a0\u202f\u066c](?=\d{3}(?:\D|$))/g, '')).sort();
};
const facts = text => text.match(/https?:\/\/[^\s<>]+|[\w.+-]+@[\w.-]+\.[a-z]+|\b(?:[a-z]+\.)+(?:org|uk|ai|com)\b/g) || [];
const escape = text => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');
const periods = {
  en: ['one month', 'two further months'], es: ['un mes', 'dos meses adicionales'], zh: ['一个月', '两个月'], hi: ['एक माह', 'दो अतिरिक्त माह'],
  ar: ['شهر واحد', 'شهرين إضافيين'], fr: ['un mois', 'deux mois supplémentaires'], pt: ['um mês', 'dois meses adicionais'],
  ru: ['одного месяца', 'двух дополнительных месяцев'], ja: ['一か月', '二か月'], de: ['eines Monats', 'zwei weitere Monate'], ko: ['한 달', '두 달'],
};
const privacyPeriods = {
  en: ['seven days', 'three days'], es: ['siete días', 'tres días'], zh: ['七天', '三天'],
  hi: ['सात दिन', 'तीन दिन'], ar: ['سبعة أيام', 'ثلاثة أيام'], fr: ['sept jours', 'trois jours'],
  pt: ['sete dias', 'três dias'], ru: ['семи дней', 'трёх дней'], ja: ['七日間', '三日間'],
  de: ['sieben Tage', 'drei Tage'], ko: ['칠 일', '삼 일'],
};

test('numeric parity normalizes grouping and Arabic-Indic/Devanagari digits without merging decimal or section facts', () => {
  for (const grouped of ['2,000', '2.000', '2 000', '2\u00a0000', '2\u202f000', '2\u066c000', '٢٬٠٠٠', '२,०००']) {
    assert.deepEqual(numbers(grouped), ['2000'], grouped);
  }
  assert.deepEqual(numbers('3.1 14 20 10% $2.50'), ['10%', '14', '2.50', '20', '3.1']);
  assert.deepEqual(numbers('1,234,567'), ['1234567']);
  assert.notDeepEqual(numbers('2,000'), numbers('2'));
});

for (const document of LEGAL_DOCUMENTS) {
  test(`${document}: English render equals origin/main ${baseline.commit}`, async () => {
    const f = fixture('en', `/legal/${document}`, { moduleMocks });
    assert.equal(f.render(await f.load(`app/legal/${document}/page.js`).default()), baseline.documents[document]);
  });
  test(`${document}: every language has identical keys, slots and English numeric/link facts`, async () => {
    const english = await legalDocument('en', document);
    for (const { code } of LOCALES) {
      assert.ok(existsSync(`lib/i18n/messages/legal/${code}/${document}.mjs`), `Missing ${code}/${document}`);
      const translated = await legalDocument(code, document);
      assert.deepEqual(Object.keys(translated.messages).sort(), Object.keys(english.messages).sort(), code);
      for (const [key, value] of Object.entries(english.messages)) {
        const other = translated.messages[key];
        assert.ok(other.trim(), `${code}/${key}`);
        assert.deepEqual(slots(other), slots(value), `${code}/${key} placeholders`);
        assert.deepEqual(numbers(other), numbers(value), `${code}/${key} numeric facts`);
        for (const fact of facts(value)) assert.ok(other.includes(fact), `${code}/${key}: ${fact}`);
      }
      if (document === 'gdpr') for (const period of periods[code]) assert.ok(translated.messages.b017.includes(period), `${code}: ${period}`);
      if (document === 'privacy') {
        const [backup, referral] = privacyPeriods[code];
        assert.ok(translated.messages.b050.includes(backup), `${code}: backup ${backup}`);
        assert.ok(translated.messages.b065.includes(referral), `${code}: referral ${referral}`);
        const { default: publicMessages } = await import(`../lib/i18n/messages/${code}.mjs`);
        // Russian declines the same defined noun in running prose.
        const library = code === 'ru' ? publicMessages['label.Library'].slice(0, -1) : publicMessages['label.Library'];
        for (const key of ['b031', 'b051']) assert.ok(translated.messages[key].includes(library), `${code}/${key}: shared Library term`);
      }
    }
  });
}

for (const document of LEGAL_DOCUMENTS) for (const { code } of LOCALES.filter(item => item.code !== 'en')) {
  test(`${code}/${document}: translated render, English link, notice and metadata`, async () => {
    const f = fixture(code, `/legal/${document}`, { moduleMocks });
    const page = f.load(`app/legal/${document}/page.js`);
    const html = f.render(await page.default());
    assert.ok(html.includes(`data-legal-translation="${document}"`));
    assert.ok(html.includes(escape(LEGAL_CHROME[code].notice)));
    assert.ok(html.includes(`href="/legal/${document}" hrefLang="en"`));
    assert.ok(html.includes(`dir="${localeInfo(code).dir}"`));
    assert.ok(html.includes(`href="${localizedHref(code, '/legal/gdpr')}"`));
    // Shared inline structures must retain all original URL/email targets;
    // internal links gain only the visitor's supported language prefix.
    for (const [, target] of baseline.documents[document].matchAll(/href="([^"]+)"/g)) {
      assert.ok(html.includes(`href="${localizedHref(code, target)}"`), `${code}/${document}: ${target}`);
    }
    assert.doesNotMatch(html, /\{(?:inline\d+|name|office|email|privacyEmail|companyNo)\}/);
    const metadata = await page.generateMetadata();
    assert.equal(metadata.alternates.canonical, `/${code}/legal/${document}`);
    assert.deepEqual(metadata.alternates.languages, languageAlternates(`/legal/${document}`));
    assert.notEqual(metadata.title, (await legalDocument('en', document)).messages.title);
    if (code === 'ar') assert.match(html, /<bdi dir="ltr">17299951<\/bdi>/);
  });
}

test('binding and chrome catalogs have identical keys/slots/numbers and no duplicates', () => {
  for (const [area, catalogs] of [['binding', BINDINGS], ['chrome', LEGAL_CHROME]]) for (const { code } of LOCALES) {
    assert.deepEqual(Object.keys(catalogs[code]).sort(), Object.keys(catalogs.en).sort());
    for (const [key, value] of Object.entries(catalogs.en)) {
      assert.deepEqual(slots(catalogs[code][key]), slots(value), `${code}/${area}/${key}`);
      assert.deepEqual(numbers(catalogs[code][key]), numbers(value), `${code}/${area}/${key}`);
    }
    const source = readFileSync(`lib/i18n/messages/legal/${code}/${area}.mjs`, 'utf8');
    const tree = ts.createSourceFile('catalog.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const keys = catalogKeys(tree);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(source.split('\n').length < 500);
  }
});

test('all document catalogs reject duplicate keys and stay within the area-file limit', () => {
  for (const document of LEGAL_DOCUMENTS) for (const { code } of LOCALES) {
    const source = readFileSync(`lib/i18n/messages/legal/${code}/${document}.mjs`, 'utf8');
    const tree = ts.createSourceFile('catalog.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const keys = catalogKeys(tree);
    assert.equal(new Set(keys).size, keys.length, `${code}/${document}: duplicate key`);
    assert.ok(source.split('\n').length < 500, `${code}/${document}: file length`);
  }
});

for (const locale of ['en', 'de', 'ja', 'ar']) test(`${locale}: BindingText preserves English element and checkbox identity/handler`, () => {
  let checked = false;
  const input = React.createElement('input', { type: 'checkbox', checked, onChange: event => { checked = event.target.checked; }, 'data-version': 'unchanged-version' });
  const english = React.createElement('span', { lang: 'en', dir: 'ltr' }, BINDINGS.en.pass);
  const f = fixture(locale, '/social-cinema/pass');
  const BindingText = f.load('components/BindingText.jsx').default;
  const html = f.render(React.createElement(BindingText, { id: 'pass' }, React.createElement('label', null, input, english)));
  assert.ok(html.includes(`<span lang="en" dir="ltr">${BINDINGS.en.pass}</span>`));
  assert.ok(html.includes('data-version="unchanged-version"'));
  input.props.onChange({ target: { checked: true } });
  assert.equal(checked, true);
  if (locale === 'en') {
    assert.equal(html, f.render(React.createElement('label', null, input, english)));
    assert.doesNotMatch(html, /data-binding-translation/);
  } else {
    assert.ok(html.includes('data-binding-translation="pass"'));
    assert.ok(html.includes(escape(LEGAL_CHROME[locale].notice)));
    assert.ok(html.includes(escape(LEGAL_CHROME[locale].agree)));
    assert.doesNotMatch(html.match(/<label[^>]*>(.*?)<\/label>/s)[1], /data-binding-translation/);
    const description = html.match(/aria-describedby="([^"]+)"/)[1];
    assert.ok(html.includes(`</label><span id="${description}"`));
    assert.ok(html.includes(`lang="${localeInfo(locale).hreflang}" dir="${localeInfo(locale).dir}"`));
    if (locale === 'ar') assert.match(html, /<bdi dir="ltr">14<\/bdi>/);
  }
});

test('audit refuses changed English, missing binding ids and unpaired English literals', () => {
  const file = 'app/veyrnox/social-cinema/pass/PassPanel.js';
  const source = readFileSync(file, 'utf8');
  assert.ok(candidates(file, source).some(row => row.kind === 'binding' && row.status === 'translated'));
  for (const changed of [source.replace('14 days', '15 days'), source.replace('id="pass"', 'id="unknown"'), '<span lang="en" dir="ltr">Missing translation</span>']) {
    assert.ok(candidates(file, changed).some(row => row.status === 'unresolved'));
  }
});

for (const locale of ['de', 'ja', 'ar']) test(`${locale}: actual Cinema Pass and subscription checkout show binding translation`, async () => {
  const { appMessagesFor } = await import('../lib/i18n/appMessages.mjs');
  const { scenarios, renderScenario } = await import('./helpers/appI18nRound3.mjs');
  const checkout = renderScenario(scenarios.find(scenario => scenario.area === 'billing'), locale, await appMessagesFor(locale));
  assert.match(checkout, /data-binding-translation="subscription"/);
  assert.match(checkout, /I agree to/);
  assert.match(checkout, /at \$10 plus applicable tax/);
  assert.match(checkout, /1200/);
  assert.ok(checkout.includes(escape(LEGAL_CHROME[locale].agree)));
  const file = 'app/veyrnox/social-cinema/pass/PassPanel.js';
  const f = fixture(locale, '/social-cinema/pass', { signedIn: true, states: {
    [file]: [[{ id: 'p', billing_interval: 'month', price_usd_cents: 500 }], 'version', null, '', false, true, false],
  }, expose: { [file]: ['Pass'] } });
  const pass = f.render(React.createElement(f.load(file).Pass, { salesOpen: true }));
  assert.match(pass, /data-binding-translation="pass"/);
  assert.ok(pass.includes(BINDINGS.en.pass));
  assert.ok(pass.includes(escape(LEGAL_CHROME[locale].notice)));
});

test('the actual source-rights checkbox preserves controlled state and reports both changes', () => {
  const file = 'app/veyrnox/_components/SourceRightsConfirmation.jsx';
  const f = fixture('de', '/app/create', { moduleMocks: {
    '../../../components/I18nProvider': { useI18n: () => ({ t: key => key }) },
  } });
  const SourceRights = f.load(file).default;
  for (const confirmed of [false, true]) {
    const changes = [];
    const tree = SourceRights({ confirmed, onChange: value => changes.push(value) });
    let input;
    function visit(node) {
      if (!React.isValidElement(node)) return;
      if (node.type === 'input') input = node;
      React.Children.forEach(node.props.children, visit);
    }
    visit(tree);
    assert.equal(input.props.checked, confirmed);
    assert.equal(input.props.id, 'create-source-rights');
    input.props.onChange({ target: { checked: true } });
    input.props.onChange({ target: { checked: false } });
    assert.deepEqual(changes, [true, false]);
  }
});

test('binding wrappers retain every baseline version identifier and gateway request', () => {
  const baseline = JSON.parse(readFileSync('tests/fixtures/legal-binding-contracts-main.json', 'utf8'));
  for (const [file, expected] of Object.entries(baseline)) {
    const source = readFileSync(file, 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    const calls = [], versions = [];
    function visit(node) {
      if (ts.isCallExpression(node) && /^(?:gatewayFetch|fetch)$/.test(node.expression.getText(tree))) calls.push(node.getText(tree));
      if (ts.isVariableDeclaration(node) && /VERSION$/.test(node.name.getText(tree))) versions.push(node.getText(tree));
      ts.forEachChild(node, visit);
    }
    visit(tree);
    assert.deepEqual({ calls, versions }, expected, file);
  }
});
