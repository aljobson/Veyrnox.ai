import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as plans from '../app/veyrnox/_lib/subscriptionPlans.js';
import * as locales from '../lib/i18n/locales.mjs';
import * as translate from '../lib/i18n/translate.mjs';
import { messagesFor } from '../lib/i18n/catalogs.mjs';
import appEnglish from '../lib/i18n/messages/app/en.mjs';
const require = createRequire(import.meta.url);
const t = translate.translator('en', { ...messagesFor('en'), ...appEnglish });
const catalog = ['lite', 'starter', 'plus'].map((family, i) => ({ id: `${family}-monthly`, billing_interval: 'month', price_usd_cents: [1000, 1900, 5900][i], credits: [157, 297, 924][i] }));

function load(states) {
  const source = readFileSync('app/veyrnox/_components/CreditSubscriptions.js', 'utf8') + '\nexport { Billing };';
  const js = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const output = { exports: {} };
  const mocks = {
    react: { ...React, useState: initial => [states.length ? states.shift() : initial, () => {}], useRef: current => ({ current }), useEffect: () => {}, useCallback: f => f },
    '../_lib/subscriptionPlans': plans,
    '../../../components/I18nProvider': { useI18n: () => ({ t, locale: 'en' }) },
    '../../../lib/i18n/locales.mjs': locales,
    '../../../lib/i18n/translate.mjs': translate,
    '../../../lib/i18n/rich': { rich: (_t, key) => key },
    '../_lib/creditSubscriptionUi': { canCheckCoolingOffRefund: () => false },
    '../_lib/hardPaywall.mjs': { TRIAL_REMINDER_DAYS: 1 },
    './VeyCardPeek': { VeyCardPeek: () => null },
    '../../lib/authClient': {}, '../_lib/gateway': {},
  };
  for (const id of ['next/link', '../../../components/LegalLink', '../../../components/BindingText']) {
    mocks[id] = { __esModule: true, default: ({ children }) => React.createElement('span', null, children) };
  }
  new Function('require', 'module', 'exports', js)(id => mocks[id] ?? require(id), output, output.exports);
  return output.exports;
}

test('current Ultra yearly card renders its snapshot price and annual interval with only three catalog plans', () => {
  for (const billing_interval of ['year', undefined]) {
    const sub = { plan_id: 'ultra-yearly', status: 'active', price_usd_cents: 123840, credits: 2411, billing_interval };
    const { Billing } = load([{ plans: catalog, packs: [] }, sub, false, true]);
    const html = renderToStaticMarkup(React.createElement(Billing, { account: 'owner', recovery: null, setRecovery: () => {} }));
    assert.match(html, /Ultra/);
    assert.match(html, /\$1,238\.40 \/ year/);
    assert.doesNotMatch(html, /app\.credits\.subscription\.plan\.ultra/);
  }
});

test('the real plan cards omit stale Ultra monthly and yearly rows', () => {
  const { Plans } = load([]);
  const html = renderToStaticMarkup(React.createElement(Plans, { plans: [...catalog,
    { id: 'ultra-monthly', billing_interval: 'month', price_usd_cents: 12900, credits: 2011 },
    { id: 'ultra-yearly', billing_interval: 'year', price_usd_cents: 123840, credits: 2011 },
  ], packs: [], onSelect: () => {} }));
  assert.doesNotMatch(html, /Ultra|1,238|129/);
  assert.match(html, /Starter/);
  assert.match(html, /Recommended/);
});
