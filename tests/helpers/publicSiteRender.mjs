import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { localizedHref } from '../../lib/i18n/locales.mjs';

// Offline SSR: actual page modules, React and locale provider; Next request and
// navigation APIs are injected. This does not claim a browser/middleware render.
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../..');
export function fixture(locale, route, { consentReady = false, states = {}, signedIn = false, preview = false, expose = {}, journey = null, messages, moduleMocks = {}, sourceOverrides = {} } = {}) {
  const cache = new Map();
  const navigate = { useRouter: () => ({ push() {} }), usePathname: () => localizedHref(locale, route), useParams: () => ({ token: 'test', network: 'facebook' }), redirect: url => { throw new Error(`redirect:${url}`); } };
  const auth = { getSession: () => signedIn ? { user: { id: 'test-user' } } : null, onSessionChange: () => () => {}, getStoredUserId: () => signedIn ? 'test-user' : '', getStoredSession: () => signedIn ? { user: { id: 'test-user' } } : null, getOAuthAuthorizationDetails() {}, respondToOAuthAuthorization() {} };
  function load(relative) {
    const absolute = path.resolve(root, relative);
    const stateValues = states[path.relative(root, absolute)];
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const module = { exports: {} };
    cache.set(absolute, module);
    const source = (sourceOverrides[path.relative(root, absolute)] ?? readFileSync(absolute, 'utf8')) + (expose[relative] ? `\nexport { ${expose[relative].join(', ')} };` : '');
    let stateIndex = 0;
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const localRequire = id => {
      if (Object.hasOwn(moduleMocks, id)) return moduleMocks[id];
      if (id === 'react' && stateValues) return { ...React, useState: initial => React.useState(stateIndex < stateValues.length ? stateValues[stateIndex++] : initial), useSyncExternalStore: (subscribe, snapshot) => snapshot() };
      if (id.endsWith('/preview') && preview) return { useCinemaPreview: () => true };
      if (id.endsWith('/veyJourneyStore') && journey) return { getJourney: () => journey, subscribeJourney: () => () => {}, initialiseJourney() {}, publishJourneyView() {}, beginJourney() {}, updateJourney() {} };
      if (id === '@posthog/next') return { usePostHog: () => ({}) };
      if (id === 'next/script') return { __esModule: true, default: () => null };
      if (id === 'react' && consentReady && absolute.endsWith('/OAuthConsent.js')) return {
        ...React, useSyncExternalStore: () => true,
        useState: initial => React.useState(initial === 'loading' ? 'ready' : initial === null ? { client: { name: 'Test assistant' }, scopes: ['openid'] } : initial),
      };
      if (id === 'next/image') return { __esModule: true, default: ({ unoptimized, ...props }) => React.createElement('img', props) };
      if (id === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) };
      if (id === 'next/navigation') return navigate;
      if (id === 'next/headers') return { headers: async () => new Map([['x-site-locale', locale], ['x-site-path', route]]) };
      if (id.endsWith('/authClient') || id.endsWith('/authClient.js')) return auth;
      if (id.endsWith('/NavBar')) return { MarketingNav: () => null, AppNav: () => null };
      if (id.endsWith('/NetworkLogo')) return { __esModule: true, default: () => null };
      if (!id.startsWith('.') && !id.startsWith('@/')) return require(id);
      const base = id.startsWith('@/') ? path.resolve(root, id.slice(2)) : path.resolve(path.dirname(absolute), id);
      const target = [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`].find(existsSync);
      if (!target) throw new Error(`Cannot resolve ${id} in ${relative}`);
      if (target.endsWith('.mjs')) return require(target);
      return load(target);
    };
    new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
    return module.exports;
  }
  const { I18nProvider } = load('components/I18nProvider.jsx');
  return {
    load,
    render: node => renderToStaticMarkup(React.createElement(I18nProvider, { locale, enabled: true, messages }, node)),
  };
}
