import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { CATALOGS, translator, pluralKey } from '../lib/i18n/translate.mjs';

const counts = [1, 2, 3, 4, 5, 11, 21, 22];
const russian = ['кредит', 'кредита', 'кредита', 'кредита', 'кредитов', 'кредитов', 'кредит', 'кредита'];
test('web Russian credit tiles and earned messages follow singular, few and many forms', () => {
    const t = translator('ru');
    counts.forEach((credits, i) => {
        assert.equal(t(pluralKey(t, 'ru', 'checkin.credits', credits), { credits }), `${credits} ${russian[i]}`);
        assert.equal(t(pluralKey(t, 'ru', 'checkin.earned', credits), { credits }), `Вы получили ${credits} ${russian[i]}.`);
    });
});
test('all web locales supply the selected reward plural forms without fallback', () => {
    for (const [locale, messages] of Object.entries(CATALOGS)) {
        const t = translator(locale);
        for (const credits of [1, 2, 3]) for (const base of ['checkin.credits', 'checkin.earned']) {
            const key = pluralKey(t, locale, base, credits);
            assert.equal(typeof messages[key], 'string', `${locale}: ${key}`);
            assert.doesNotMatch(t(key, { credits }), /checkin\.|\{credits\}/);
        }
    }
    const ar = translator('ar');
    assert.equal(ar(pluralKey(ar, 'ar', 'checkin.credits', 2), { credits: 2 }), '2 من الرصيد');
    const hi = translator('hi');
    assert.equal(hi(pluralKey(hi, 'hi', 'checkin.earned', 2), { credits: 2 }), 'आपने 2 क्रेडिट कमाए।');
});
test('the real web dialog renders a hidden claimed label and an aria-hidden tick', () => {
    const source = readFileSync('app/veyrnox/_components/CheckInDialog.js', 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
    const stubs = {
        react: React, 'react/jsx-runtime': jsx,
        '../../../components/I18nProvider': { useI18n: () => ({ t: translator('en'), locale: 'en' }) },
        '../../../lib/i18n/translate.mjs': { pluralKey },
        './Modal': { Modal: ({ children }) => createElement('div', null, children) },
        '../_lib/gateway': {},
    };
    const exports = {};
    new Function('require', 'exports', output)(name => { assert.ok(name in stubs, name); return stubs[name]; }, exports);
    const status = { claimed_today: true, streak: 3, next_day: 4, rewards: [1, 1, 2, 2, 2, 3] };
    const html = renderToStaticMarkup(createElement(exports.CheckInDialog, { status }));
    assert.match(html, /<span aria-hidden="true">✓<\/span><span class="sr-only">Claimed today<\/span>/);
    assert.equal((html.match(/class="sr-only"/g) || []).length, 1);
    assert.match(html, /2 credits/);
});
