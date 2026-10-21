import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { register } from 'node:module';
import { localeFromCookie, localeCookie, rememberLocale, isAppLocalePath, isSmartLinkLocalePath } from '../lib/i18n/localeCookie.mjs';
import { LOCALES, switchLanguageHref } from '../lib/i18n/locales.mjs';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c);}`));
const { middleware } = await import('../middleware.js');

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(file) : /\.[cm]?[jt]sx?$/.test(file) ? [file] : [];
  });
}

test('locale cookie validates codes, case, missing values, records and duplicates', () => {
  for (const { code } of LOCALES) {
    assert.equal(localeFromCookie(`unrelated=x; veyrnox_locale=${code}; another=y`), code);
    assert.equal(localeFromCookie([{ name: 'unrelated', value: 'ar' }, { name: 'veyrnox_locale', value: code }]), code);
    assert.equal(localeFromCookie([`unrelated=x`, `veyrnox_locale=${code}`]), code);
  }
  for (const value of [null, undefined, '', [], 'veyrnox_locale=DE', 'veyrnox_locale=xx', 'veyrnox_locale=%64e', 'veyrnox_locale=', 'other=de', 'veyrnox_locale=de; veyrnox_locale=ar', [{ name: 'veyrnox_locale', value: ['de'] }]]) {
    assert.equal(localeFromCookie(value), 'en', JSON.stringify(value));
  }
});

test('language choices set a one-year display cookie and English expires it', () => {
  assert.equal(localeCookie('de', true), 'veyrnox_locale=de; Path=/; SameSite=Lax; Max-Age=31536000; Secure');
  assert.equal(localeCookie('en', true), 'veyrnox_locale=; Path=/; SameSite=Lax; Max-Age=0; Secure');
  assert.equal(localeCookie('junk', false), 'veyrnox_locale=; Path=/; SameSite=Lax; Max-Age=0');
  const previous = globalThis.document;
  try {
    globalThis.document = { cookie: '' };
    rememberLocale('ja'); assert.match(document.cookie, /^veyrnox_locale=ja;/);
    rememberLocale('en'); assert.match(document.cookie, /^veyrnox_locale=;.*Max-Age=0/);
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
  for (const component of ['LanguageMenu', 'LanguageSwitcher']) {
    const source = readFileSync(`app/veyrnox/_components/${component}.js`, 'utf8');
    assert.match(source, /onClick=\{\([^)]*\) =>[\s\S]*?rememberLocale\(l.code\)/);
    assert.match(source, /languagesEnabled/);
  }
  assert.equal(switchLanguageHref('ja', '/app/create?model=test#prompt'), '/app/create?model=test#prompt');
  assert.equal(switchLanguageHref('de', '/es/app/library'), '/app/library');
});

test('middleware overwrites forged page headers, using cookies only for enabled app pages', async () => {
  const previous = process.env.LOCALES_ENABLED;
  try {
    for (const enabled of ['true', 'false']) {
      process.env.LOCALES_ENABLED = enabled;
      for (const route of ['/app', '/app/create', '/app/library', '/app/account', '/app/chat', '/app/admin', '/app/admin/users', '/', '/pricing', '/legal/privacy', '/application', '/s/test', '/s/test/', '/s/test/go/item', '/s', '/s/test/extra']) {
        for (const cookie of ['', 'veyrnox_locale=ar', 'veyrnox_locale=DE', 'veyrnox_locale=garbage']) {
          const request = new Request(`https://veyrnox.test${route}`, { headers: { cookie, 'x-site-locale': 'ja', 'x-site-path': '/app/create' } });
          const response = await middleware(request);
          // OpenNext overlays headers set by middleware; deleting is insufficient.
          const forwarded = new Headers(request.headers);
          response.headers.forEach((value, key) => { if (key.startsWith('x-middleware-request-')) forwarded.set(key.slice(21), value); });
          assert.equal(forwarded.get('x-site-locale'), enabled === 'true' && (isAppLocalePath(route) || isSmartLinkLocalePath(route)) && cookie === 'veyrnox_locale=ar' ? 'ar' : 'en', `${enabled} ${route} ${cookie}`);
          assert.equal(forwarded.get('x-site-path'), route === '/' ? route : route.replace(/\/$/, ''));
        }
      }
    }
    process.env.LOCALES_ENABLED = 'true';
    const publicResponse = await middleware(new Request('https://veyrnox.test/de/pricing', { headers: { cookie: 'veyrnox_locale=ar', 'x-site-locale': 'ja' } }));
    assert.equal(publicResponse.headers.get('x-middleware-request-x-site-locale'), 'de');
    const redirect = await middleware(new Request('https://veyrnox.test/es/app/create?model=test'));
    assert.equal(redirect.status, 307);
    assert.equal(redirect.headers.get('location'), 'https://veyrnox.test/app/create?model=test');
  } finally { if (previous === undefined) delete process.env.LOCALES_ENABLED; else process.env.LOCALES_ENABLED = previous; }
});

test('API and package code never reads the display cookie or locale header', () => {
  for (const file of [...files('app/api'), ...files('packages')]) {
    if (file.includes('/node_modules/')) continue;
    assert.doesNotMatch(readFileSync(file, 'utf8'), /veyrnox_locale|x-site-locale|i18n\/(?:localeCookie|server|headerNames|appMessages)/, file);
  }
});
