import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import ts from 'typescript';
import { fixture } from './helpers/publicSiteRender.mjs';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { translator } from '../lib/i18n/translate.mjs';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c);}`));
const { middleware } = await import('../middleware.js');
// All objects were checked against frozen English baseline 22945bc05d17ba1deadf0e1e05a76f4d1e21be76.
const english = JSON.parse(readFileSync(new URL('./fixtures/app-metadata-english.json', import.meta.url), 'utf8'));
const files = Object.keys(english);

// Execute the actual metadata exports and their imports without loading unrelated
// client UI. Request headers below come from the real middleware, not a locale mock.
function metadataModule(file, headers, extraMocks = {}) {
  const source = readFileSync(file, 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const metadataSource = tree.statements.filter(node => {
    if (ts.isImportDeclaration(node)) return /i18n\/(?:server|translate)|\/seo$|publishFeature/.test(node.moduleSpecifier.text);
    if (ts.isFunctionDeclaration(node)) return node.name?.text === 'generateMetadata';
    return ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(tree) === 'metadata');
  }).map(node => node.getText(tree)).join('\n');
  return fixture('en', '/app', {
    sourceOverrides: { [file]: metadataSource },
    moduleMocks: { 'next/headers': { headers: async () => headers }, ...extraMocks },
  }).load(file);
}

async function requestHeaders(route, cookie = '') {
  const request = new Request(`https://veyrnox.test${route}`, { headers: { cookie, 'x-site-locale': 'ja', 'x-site-path': '/' } });
  const response = await middleware(request);
  const headers = new Headers(request.headers);
  response.headers.forEach((value, key) => {
    if (key.startsWith('x-middleware-request-')) headers.set(key.slice(21), value);
  });
  return headers;
}

function environment(context, values = {}) {
  const settings = { LOCALES_ENABLED: 'true', PUBLISH_ENABLED: 'true', PUBLISH_TESTER_AUTH_IDS: '', ...values };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  context.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

test('every app metadata export preserves the complete English metadata object', async context => {
  environment(context);
  for (const file of files) {
    const route = file.replace('app/veyrnox', '').replace(/\/(?:layout|page)\.js$/, '');
    const headers = await requestHeaders(route);
    const module = metadataModule(file, headers);
    const metadata = module.generateMetadata ? await module.generateMetadata() : module.metadata;
    assert.deepEqual(metadata, english[file], file);
  }
});

const titles = {
  en: ['Create', 'Library', 'Account & security', 'Veyrnox.ai Publish', 'LLM Chat'],
  de: ['Erstellen', 'Bibliothek', 'Konto und Sicherheit', 'Veyrnox.ai Publish', 'LLM-Chat'],
  ar: ['إنشاء', 'المكتبة', 'الحساب والأمان', 'Veyrnox.ai Publish', 'محادثة LLM'],
};
for (const [cookie, locale] of [['', 'en'], ['veyrnox_locale=de', 'de'], ['veyrnox_locale=ar', 'ar'], ['veyrnox_locale=junk', 'en']]) {
  test(`metadata follows the validated cookie: ${cookie || 'absent'}`, async context => {
    environment(context);
    for (const [index, area] of ['create', 'library', 'account', 'publish', 'chat'].entries()) {
      const headers = await requestHeaders(`/app/${area}`, cookie);
      const parent = await metadataModule('app/veyrnox/app/layout.js', headers).generateMetadata();
      const metadata = await metadataModule(`app/veyrnox/app/${area}/layout.js`, headers).generateMetadata();
      assert.equal(metadata.title, titles[locale][index]);
      assert.equal(parent.title.template, '%s — Veyrnox.ai');
      assert.equal(parent.title.template.replace('%s', metadata.title), `${titles[locale][index]} — Veyrnox.ai`);
      assert.doesNotMatch(JSON.stringify(metadata), /app\.meta\./);
      if (metadata.description) assert.equal(metadata.description, (await appMessagesFor(locale))[`app.meta.${area}.description`]);
      if (metadata.openGraph) {
        assert.equal(metadata.openGraph.title, `${metadata.title} — Veyrnox.ai`);
        assert.equal(metadata.openGraph.description, metadata.description);
      }
    }
  });
}

test('all metadata keys resolve in every catalog and English fallbacks never expose keys', async context => {
  environment(context);
  for (const locale of ['en', 'es', 'zh', 'hi', 'ar', 'fr', 'pt', 'ru', 'ja', 'de', 'ko']) {
    const messages = await appMessagesFor(locale);
    assert.equal(Object.keys(messages).filter(key => key.startsWith('app.meta.')).length, 26);
    for (const file of files.filter(file => !file.includes('/admin/'))) {
      const headers = await requestHeaders('/app', `veyrnox_locale=${locale}`);
      const metadata = await metadataModule(file, headers).generateMetadata();
      assert.doesNotMatch(JSON.stringify(metadata), /app\.meta\./);
      assert.ok(Object.values(messages).includes(metadata.title.default ?? metadata.title), file);
    }
  }
  const headers = await requestHeaders('/app', 'veyrnox_locale=de');
  for (const file of files.filter(file => !file.includes('/admin/'))) {
    const serverImport = readFileSync(file, 'utf8').match(/import \{ getT \} from '([^']+)'/)[1];
    const module = metadataModule(file, headers, { [serverImport]: { getT: async () => ({ t: translator('de', {}) }) } });
    assert.deepEqual(await module.generateMetadata(), english[file], `missing-key fallback: ${file}`);
  }
});

test('admin stays English and disabled locales or Publish retain their existing behavior', async context => {
  environment(context);
  for (const cookie of ['veyrnox_locale=de', 'veyrnox_locale=ar']) {
    const headers = await requestHeaders('/app/admin', cookie);
    assert.equal(headers.get('x-site-locale'), 'en');
    assert.deepEqual(metadataModule('app/veyrnox/app/admin/layout.js', headers).metadata, english['app/veyrnox/app/admin/layout.js']);
    assert.equal((await metadataModule('app/veyrnox/app/layout.js', headers).generateMetadata()).title.default, 'Explore');
  }
  process.env.LOCALES_ENABLED = 'false';
  const headers = await requestHeaders('/app/create', 'veyrnox_locale=ar');
  assert.deepEqual(await metadataModule('app/veyrnox/app/create/layout.js', headers).generateMetadata(), english['app/veyrnox/app/create/layout.js']);
  process.env.PUBLISH_ENABLED = 'false';
  assert.deepEqual(await metadataModule('app/veyrnox/app/publish/layout.js', headers).generateMetadata(), { robots: { index: false, follow: false } });
});
