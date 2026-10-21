import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkCatalog } from '../lib/i18n/check.mjs';
import { TOOL_TASKS } from '../app/veyrnox/_lib/tools.js';
import { GUIDES } from '../app/veyrnox/_lib/guides.js';
import { modelFacts } from '../app/veyrnox/_lib/modelPages.js';
import { ODDLING_ARCHETYPES, ODDLING_SHOWS, ODDLING_TONES } from '../app/veyrnox/_lib/character.js';
import { listPublicOddlings, localizeOddling } from '../app/veyrnox/_lib/oddlingsPublic.js';
import { CATALOGS, messagesFor, translator, richParts } from '../lib/i18n/translate.mjs';
import {
  LOCALES, LOCALIZED_PATHS, localesEnabled, splitLocalePath, isLocalizedPath, localizedHref, languageAlternates, localeInfo, switchLanguageHref,
} from '../lib/i18n/locales.mjs';

const en = CATALOGS.en;

test('every language has a catalog that matches English key for key', () => {
  for (const l of LOCALES) {
    assert.ok(CATALOGS[l.code], `${l.code} has a catalog`);
    assert.deepEqual(checkCatalog(en, CATALOGS[l.code], l.code), []);
  }
});

test('ten languages besides English, Arabic runs right to left', () => {
  assert.equal(LOCALES.filter((l) => l.code !== 'en').length, 10);
  assert.equal(localeInfo('ar').dir, 'rtl');
  assert.equal(localeInfo('pt').hreflang, 'pt-BR');
  assert.equal(localeInfo('xx').code, 'en');
});

test('numbers and units that are policy survive translation', () => {
  for (const l of LOCALES) {
    const m = messagesFor(l.code);
    assert.match(m['home.faq.8.a'], /429/, l.code);
    assert.match(m['home.faq.8.a'], /Retry-After/, l.code);
    assert.match(m['home.faq.3.a'], /10/, l.code);
    assert.match(m['home.faq.9.a'], /90/, l.code);
  }
});

test('language prefix routing', () => {
  assert.deepEqual(splitLocalePath('/es'), { locale: 'es', rest: '/' });
  assert.deepEqual(splitLocalePath('/fr/pricing'), { locale: 'fr', rest: '/pricing' });
  assert.equal(splitLocalePath('/en').locale, null, 'English has no prefix');
  assert.equal(splitLocalePath('/app/create').locale, null);
  assert.equal(splitLocalePath('/m').locale, null);
});

test('only translated pages take the prefix', () => {
  assert.ok(LOCALIZED_PATHS.has('/'));
  assert.equal(localizedHref('es', '/'), '/es');
  assert.equal(localizedHref('es', '/#faq'), '/es#faq');
  assert.equal(localizedHref('es', '/pricing'), '/es/pricing');
  assert.equal(localizedHref('es', '/social-cinema'), '/es/social-cinema');
  assert.ok(LOCALIZED_PATHS.has('/pricing'));
  assert.equal(localizedHref('es', 'mailto:legal@veyrnox.com'), 'mailto:legal@veyrnox.com');
  assert.equal(localizedHref('en', '/'), '/');
  assert.equal(localizedHref('zz', '/'), '/');
});

test('alternates name every language and x-default', () => {
  const alt = languageAlternates('/');
  assert.equal(alt.en, '/');
  assert.equal(alt['zh-Hans'], '/zh');
  assert.equal(alt['pt-BR'], '/pt');
  assert.equal(alt['x-default'], '/');
  assert.equal(Object.keys(alt).length, LOCALES.length + 1);
});

test('translator falls back to English, then to the key', () => {
  const t = translator('es');
  assert.equal(t('nope.key'), 'nope.key');
  assert.equal(t.label('Not a listed label'), 'Not a listed label');
  assert.equal(translator('en')('home.cards.looks', { n: 3 }), '3 looks');
  assert.equal(richParts('a {x} b').length, 3);
});

test('languages are off unless the var is exactly "true"', () => {
  assert.equal(localesEnabled({}), false);
  assert.equal(localesEnabled({ LOCALES_ENABLED: 'false' }), false);
  assert.equal(localesEnabled({ LOCALES_ENABLED: 'true' }), true);
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'));
  assert.equal(config.vars.LOCALES_ENABLED, 'true');
  assert.equal(config.env.staging.vars.LOCALES_ENABLED, 'true');
});

test('every language has a flag and a name for the picker', () => {
  for (const l of LOCALES) {
    assert.match(l.flag, /^\p{Regional_Indicator}{2}$/u, l.code);
    assert.ok(l.name.length > 0, l.code);
  }
});

test('the picker keeps a translated page and falls back to home for the rest', () => {
  assert.equal(switchLanguageHref('fr', '/'), '/fr');
  assert.equal(switchLanguageHref('fr', '/es'), '/fr');
  assert.equal(switchLanguageHref('en', '/ja'), '/');
  assert.equal(switchLanguageHref('de', '/pricing'), '/de/pricing', 'pricing is translated');
  assert.equal(switchLanguageHref('de', '/social-cinema'), '/de/social-cinema', 'Cinema is translated');
  assert.equal(switchLanguageHref('en', '/es/pricing'), '/pricing');
  assert.equal(switchLanguageHref('en', '/social-cinema'), '/social-cinema', 'English on an English page stays put');
});

test('every tool group on /tools has translated words, and every MCP tool a description', () => {
  for (const task of [...TOOL_TASKS, { key: 'other' }]) {
    assert.ok(en[`tools.t.${task.key}.label`], `${task.key} label`);
    assert.ok(en[`tools.t.${task.key}.blurb`], `${task.key} blurb`);
  }
  for (const name of ['list_models', 'estimate_generation', 'get_generation', 'list_generations', 'get_balance']) {
    assert.ok(en[`mcp.tool.${name}`], name);
  }
});

test('the Publish copy on /mcp exists for every Publish tool and is shown only behind the switch (ADR-0112)', async () => {
  const { MCP_PUBLISH_COPY: copy } = await import('../lib/i18n/mcpPublishCopy.mjs');
  const { readFileSync } = await import('node:fs');
  const names = [...readFileSync(new URL('../lib/veyrnoxPublishMcp.js', import.meta.url), 'utf8').matchAll(/registerTool\('([^']+)'/g)].map((m) => m[1]);
  assert.equal(names.length, 7);
  for (const name of names) assert.ok(copy[`mcp.tool.${name}`], name);
  for (const key of ['lead', 's3.body', 'what.title', 'what.p', 'safe.kicker', 'safe.title', 'safe.p1', 'safe.p2', 'safe.p3']) {
    assert.ok(copy[`mcp.pub.${key}`], key);
    assert.equal(en[`mcp.pub.${key}`], copy[`mcp.pub.${key}`]);
  }
  const page = readFileSync(new URL('../app/veyrnox/mcp/page.js', import.meta.url), 'utf8');
  assert.match(page, /publishAutomationEnabled\(\)/);
  const consent = readFileSync(new URL('../app/veyrnox/oauth/consent/page.js', import.meta.url), 'utf8');
  assert.match(consent, /publishOpen=\{publishAutomationEnabled\(\)\}/);
});

test('every guide, step and link has catalog words in English, and the English matches the data', () => {
  for (const g of GUIDES) {
    assert.equal(en[`guide.${g.id}.title`], g.title);
    assert.equal(en[`guide.${g.id}.summary`], g.summary);
    g.steps.forEach((step, i) => {
      assert.equal(en[`guide.${g.id}.s${i + 1}.title`], step.title, `${g.id} step ${i + 1}`);
      assert.equal(en[`guide.${g.id}.s${i + 1}.body`], step.body, `${g.id} step ${i + 1} body`);
    });
    g.links.forEach((link, i) => assert.equal(en[`guide.${g.id}.l${i + 1}`], link.label, `${g.id} link ${i + 1}`));
  }
});

test('guide pages take a prefix, the bare prefix path does not', () => {
  assert.equal(isLocalizedPath('/guides/credits'), true);
  assert.equal(isLocalizedPath('/guides'), true);
  assert.equal(isLocalizedPath('/guides/'), true);
  assert.equal(localizedHref('fr', '/guides/credits'), '/fr/guides/credits');
  assert.equal(switchLanguageHref('de', '/fr/guides/library'), '/de/guides/library');
  assert.equal(isLocalizedPath('/presets/abc'), true, 'template detail UI is translated');
  assert.equal(isLocalizedPath('/presets'), true);
});

test('model detail pages take a prefix and their fact labels follow the language', () => {
  assert.equal(isLocalizedPath('/models/wan-2.5-kie'), true);
  assert.equal(localizedHref('ja', '/models/wan-2.5-kie'), '/ja/models/wan-2.5-kie');
  const model = {
    modality: 'image-to-video', kind: 'video', durations: [5, 10],
    capabilities: { inputs: { prompt: { type: 'string' }, aspect_ratio: { type: 'enum', values: ['16:9', '9:16'] } }, media: { image: { required: true } } },
  };
  const english = modelFacts(model);
  const german = modelFacts(model, translator('de'));
  assert.equal(english[0].label, 'Mode');
  assert.equal(german.length, english.length);
  assert.notEqual(german[0].label, english[0].label, 'Mode label is translated');
  assert.equal(german.at(-1).value, '16:9, 9:16', 'catalog values stay as they are');
});

test('every Oddling has catalog words equal to the cast data, and localizing keeps names and ids', () => {
  const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  for (const a of ODDLING_ARCHETYPES) {
    assert.equal(en[`oddling.${a.id}.hook`], a.hook, `${a.id} hook`);
    assert.equal(en[`oddling.${a.id}.accent`], a.accent, `${a.id} accent`);
    assert.equal(en[`oddling.${a.id}.obsession`], a.picks.oddling_obsession, `${a.id} obsession`);
  }
  for (const [name, note] of ODDLING_TONES) {
    assert.equal(en[`oddling.voice.${slug(name)}.name`], name);
    assert.equal(en[`oddling.voice.${slug(name)}.note`], note);
  }
  for (const [name, note] of ODDLING_SHOWS) {
    assert.equal(en[`oddling.show.${slug(name)}.name`], name);
    assert.equal(en[`oddling.show.${slug(name)}.note`], note);
  }
  const first = listPublicOddlings()[0];
  const english = localizeOddling(first);
  assert.equal(english.hook, first.hook, 'English output is unchanged');
  assert.equal(english.portrait.alt, first.portrait.alt);
  const japanese = localizeOddling(first, translator('ja'));
  assert.equal(japanese.name, first.name, 'names stay as they are');
  assert.equal(japanese.id, first.id);
  assert.notEqual(japanese.hook, first.hook, 'the hook is translated');
  assert.equal(isLocalizedPath('/oddlings'), true);
  assert.equal(isLocalizedPath(`/oddlings/${first.id}`), true);
});
