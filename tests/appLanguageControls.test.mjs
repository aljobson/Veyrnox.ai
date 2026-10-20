import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { translator } from '../lib/i18n/translate.mjs';
import * as localeCookie from '../lib/i18n/localeCookie.mjs';
import * as locales from '../lib/i18n/locales.mjs';

const require = createRequire(import.meta.url);
function control(name, pathname, enabled = true, saveAccountLanguage = () => {}) {
  const file = `app/veyrnox/_components/${name}.js`;
  const source = readFileSync(file, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  const dependencies = {
    '../../lib/accountLanguageClient.js': { saveAccountLanguage },
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
        link.props.onClick({ button: 0 });
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
    globalThis.window = { location: { href: 'https://veyrnox.test/app/library?kind=image#saved', search: '?kind=image', hash: '#saved', reload: () => { reloads++; } } };
    const tree = control('LanguageMenu', '/app/library');
    const link = find(tree, 'ja');
    assert.equal(link.props.href, '/app/library?kind=image#saved');
    link.props.onClick({ button: 0, preventDefault: () => { prevented++; } });
    assert.equal(prevented, 1);
    assert.equal(reloads, 1);
    assert.equal(window.location.href, 'https://veyrnox.test/app/library?kind=image#saved');
    assert.match(document.cookie, /^veyrnox_locale=ja;/);
    find(tree, 'en').props.onClick({ button: 0, preventDefault() {} });
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

test('modified and auxiliary app language clicks preserve the current cookie and full address', () => {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  try {
    globalThis.document = { cookie: 'veyrnox_locale=de' };
    globalThis.window = { location: { search: '?kind=image', hash: '#saved', reload() { assert.fail('modified clicks must not reload'); } } };
    const link = find(control('LanguageMenu', '/app/library'), 'ja');
    assert.equal(link.props.href, '/app/library?kind=image#saved');
    for (const modifiers of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      link.props.onClick({ button: 0, ...modifiers, preventDefault() { assert.fail('native navigation must remain available'); } });
      assert.equal(document.cookie, 'veyrnox_locale=de');
    }
    link.props.onAuxClick({ button: 1 });
    assert.equal(document.cookie, 'veyrnox_locale=de');
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});


test('both language controls sync only plain clicks, after the cookie is written', () => {
  const previous = globalThis.document;
  try {
    globalThis.document = { cookie: '' };
    for (const name of ['LanguageMenu', 'LanguageSwitcher']) {
      const choices = [];
      const tree = control(name, '/pricing', true, code => {
        assert.match(document.cookie, new RegExp(`^veyrnox_locale=${code === 'en' ? '' : code};`));
        choices.push(code);
      });
      const link = find(tree, 'de');
      for (const event of [{ button: 1 }, { button: 0, metaKey: true }, { button: 0, ctrlKey: true }, { button: 0, shiftKey: true }, { button: 0, altKey: true }]) link.props.onClick(event);
      assert.deepEqual(choices, []);
      link.props.onClick({ button: 0 });
      find(tree, 'en').props.onClick({ button: 0 });
      assert.deepEqual(choices, ['de', 'en']);
    }
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});
