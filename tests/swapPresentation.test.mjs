import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { capabilityFor, publicCapabilities } from '../lib/modelCapabilities.js';
import { readEnglishCatalog } from '../apps/mobile/scripts/sync-web-i18n.mjs';
import { translator } from '../lib/i18n/translate.mjs';
import { appMessagesFor } from '../lib/i18n/appMessages.mjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { englishAppImports } from './helpers/appI18nStub.mjs';
import * as sourceSlots from '../lib/generationSourceSlots.mjs';
import * as inputTypes from '../lib/uploadInputTypes.mjs';
import * as convert from '../app/veyrnox/_lib/uploadConvert.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
function load(path, imports = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)(id => imports[id] ?? {}, module, module.exports);
  return module.exports;
}
const records = ['fal-ai/minimax-h3-max-recast', 'crun:wan/2-2-animate-replace'].map(capabilityFor);
const caps = records.map(publicCapabilities);
const mobileEn = readEnglishCatalog();
const mobileT = key => mobileEn[key] ?? key;
const mobile = load('apps/mobile/src/lib/sources.ts', { './i18n': { t: mobileT } });
class ApiError extends Error { constructor(code) { super(code); this.code = code; } }
class OfflineError extends Error {}
const submit = load('apps/mobile/src/lib/generationSubmit.ts', { './i18n': { t: mobileT }, './api': { ApiError }, './network': { OfflineError } });
const { SourcePickers } = load('app/veyrnox/_components/SourcePickers.js', {
  react: require('react'), 'react/jsx-runtime': require('react/jsx-runtime'), './Icon': { Icon: () => null },
  '../../../components/I18nProvider': englishAppImports['../../../../components/I18nProvider'],
  '../../../lib/i18n/translate.mjs': englishAppImports['../../../../lib/i18n/translate.mjs'],
  '../../../lib/i18n/locales.mjs': englishAppImports['../../../../lib/i18n/locales.mjs'],
  '../../../lib/generationSourceSlots.mjs': sourceSlots, '../../../lib/uploadInputTypes.mjs': inputTypes,
  '../_lib/uploadConvert.mjs': convert,
});

test('web source pickers show translated Swap labels and the declared duration/dimension limits', () => {
  for (const [i, capabilities] of caps.entries()) {
    const html = renderToStaticMarkup(createElement(SourcePickers, { media: capabilities.media, sources: {}, onPick() {} }));
    assert.match(html, /Video to change/);
    assert.match(html, i ? /Photo of the new person/ : /Photos of the new people/);
    assert.match(html, i ? /2–10 s/ : /5–10 s/);
    assert.match(html, /accept="video\/mp4"/);
    if (i) { assert.match(html, /200–2048 pixels on each side/); assert.match(html, /200–4096 pixels on each side/); }
    else assert.doesNotMatch(html, /pixels on each side/);
  }
});

test('mobile passes Swap slots through unchanged and prechecks short Recast / Quick photo and video dimensions', () => {
  for (const [i, capabilities] of caps.entries()) {
    const slots = mobile.slotsFor({ capabilities });
    for (const slot of slots) {
      const spec = capabilities.media[slot.slot];
      assert.equal(slot.label, mobileT(`label.${spec.label}`));
      for (const field of ['maxFiles', 'minSeconds', 'maxSeconds', 'minSide', 'maxSide']) assert.equal(slot[field], spec[field]);
    }
    const video = slots.find(s => s.slot === 'video'), image = slots.find(s => s.slot === 'image');
    const file = { uri: 'fixture.mp4', mimeType: 'video/mp4', size: 1000, durationSeconds: i ? 2 : 5, width: 640, height: 360 };
    assert.equal(mobile.checkPicked('video', file, video).ok, true);
    assert.equal(mobile.checkPicked('video', { ...file, durationSeconds: 1 }, video).error, 'too_short');
    assert.equal(mobile.checkPicked('video', { ...file, mimeType: 'video/quicktime' }, video).error, 'type');
    if (i) {
      assert.equal(mobile.checkPicked('video', { ...file, width: 2049 }, video).error, 'resolution');
      assert.equal(mobile.checkPicked('image', { ...file, mimeType: 'image/jpeg', width: 199 }, image).error, 'resolution');
      assert.equal(mobile.checkPicked('image', { ...file, mimeType: 'image/jpeg', height: 4097 }, image).error, 'resolution');
    }
  }
  for (const code of ['source_too_short', 'source_resolution_out_of_range']) {
    assert.equal(submit.generationMessage(new ApiError(code)), mobileEn[`app.create.error.${code}`]);
    assert.doesNotMatch(submit.generationMessage(new ApiError(code)), /3 seconds|720|2160/);
  }
});

test('all eleven locales share Swap keys and bound-agnostic errors with mobile', async () => {
  const keys = ['label.Video to change', 'label.Photo of the new person', 'label.Photos of the new people', 'app.create.swapConsentNotice', 'app.create.error.source_too_short', 'app.create.error.source_resolution_out_of_range'];
  for (const locale of ['en', 'ar', 'de', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh']) {
    const app = await appMessagesFor(locale), web = translator(locale, { ...(await import(`../lib/i18n/messages/${locale}.mjs`)).default, ...app });
    const phone = locale === 'en' ? mobileEn : load(`apps/mobile/src/lib/i18n/messages/${locale}.ts`).default;
    for (const key of keys) {
      assert.ok(phone[key], `${locale}: ${key}`);
      assert.equal(phone[key], web(key), `${locale}: ${key}`);
      if (key.includes('.error.')) assert.doesNotMatch(phone[key], /\d/);
    }
  }
});

test('the short consent notice is scoped to both Swap models in each existing Create flow', () => {
  for (const path of ['app/veyrnox/app/create/page.js', 'apps/mobile/src/app/(app)/create/[modelId].tsx']) {
    const source = read(path);
    assert.match(source, /\['swap-recast', 'swap-quick'\]\.includes\(model(?:Id|\.id)\)[^\n]+t\('app\.create\.swapConsentNotice'\)/);
    assert.equal((source.match(/app\.create\.swapConsentNotice/g) || []).length, 1);
  }
});

test('mobile model list and sitemap omit inactive Swap offers using the public catalog', async t => {
  const media = load('apps/mobile/src/lib/media.ts', { './api': { API_BASE: 'https://fixture.test', ApiError }, './network': { markOnline() {}, markOffline() {} } });
  t.mock.method(globalThis, 'fetch', async url => { assert.equal(url, 'https://fixture.test/api/catalog'); return Response.json({ models: [] }); });
  assert.deepEqual(await media.fetchCatalog(), []);
  // Execute the actual sitemap model projection with the same inactive-only catalog result.
  const source = read('app/sitemap.js');
  const body = source.slice(source.indexOf('async function modelPages('), source.indexOf('// Same-kind pairs'));
  const modelPages = new Function('listModelsForDetails', `${body}; return modelPages;`)(async () => []);
  assert.deepEqual(await modelPages(path => ({ url: path })), []);
});
