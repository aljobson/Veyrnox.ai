import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { translator } from '../lib/i18n/translate.mjs';
import * as localeCookie from '../lib/i18n/localeCookie.mjs';
import * as locales from '../lib/i18n/locales.mjs';

const require = createRequire(import.meta.url);
function control(name, pathname, enabled = true) {
  const file = `app/veyrnox/_components/${name}.js`;
  const source = readFileSync(file, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  const dependencies = {
    react: { useState: () => [true, () => {}], useRef: () => ({ current: null }), useEffect() {} },
    'next/navigation': { usePathname: () => pathname },
    '../../../components/I18nProvider': { useI18n: () => ({ locale: 'de', languagesEnabled: enabled, t: translator('de') }) },
    '../../../lib/i18n/locales.mjs': locales,
    '../../../lib/i18n/localeCookie.mjs': localeCookie,
    '../../../lib/i18n/translate.mjs': { translator },
  };
  new Function('require', 'module', 'exports', code)(id => dependencies[id] || require(id), module, module.exports);
  return module.exports[name]({ locale: 'de', path: pathname });
}
function find(node, code) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) return node.map(child => find(child, code)).find(Boolean);
  if (node.props?.['data-locale'] === code) return node;
  return find(node.props?.children, code);
}

test('both rendered public language controls set and clear the cookie', () => {
  const previous = globalThis.document;
  try {
    globalThis.document = { cookie: '' };
    for (const name of ['LanguageMenu', 'LanguageSwitcher']) {
      const tree = control(name, name === 'LanguageSwitcher' ? '/pricing' : '/de/pricing');
      for (const code of ['ja', 'ar', 'en']) {
        const link = find(tree, code);
        assert.ok(link, `${name}: ${code}`);
        link.props.onClick({});
        assert.match(document.cookie, new RegExp(`^veyrnox_locale=${code === 'en' ? '' : code};`));
        assert.ok(document.cookie.includes(`Max-Age=${code === 'en' ? 0 : 31536000}`));
      }
      assert.equal(control(name, '/pricing', false), null);
    }
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test('app menu reloads the same page after remembering a choice and admin has no menu', () => {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  let reloads = 0, prevented = 0;
  try {
    globalThis.document = { cookie: '' };
    globalThis.window = { location: { href: 'https://veyrnox.test/app/library?kind=image#saved', reload: () => { reloads++; } } };
    const tree = control('LanguageMenu', '/app/library');
    const link = find(tree, 'ja');
    assert.equal(link.props.href, '/app/library');
    link.props.onClick({ preventDefault: () => { prevented++; } });
    assert.equal(prevented, 1);
    assert.equal(reloads, 1);
    assert.equal(window.location.href, 'https://veyrnox.test/app/library?kind=image#saved');
    assert.match(document.cookie, /^veyrnox_locale=ja;/);
    find(tree, 'en').props.onClick({ preventDefault() {} });
    assert.match(document.cookie, /^veyrnox_locale=;.*Max-Age=0/);
    assert.equal(control('LanguageMenu', '/app/admin'), null);
    assert.equal(control('LanguageMenu', '/app/admin/users'), null);
    assert.match(readFileSync('app/veyrnox/_components/NavBar.js', 'utf8').split('export function AppNav')[1], /<LanguageMenu \/>/);
    assert.match(readFileSync('app/veyrnox/_components/NavBar.js', 'utf8').split('export function AppNav')[1], /<MobileMenu[\s\S]*?languageMenu/);
    assert.match(readFileSync('app/veyrnox/_components/MobileMenu.js', 'utf8'), /languageMenu && <LanguageMenu id="vx-studio-language-menu"/);
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});
