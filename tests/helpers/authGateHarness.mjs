import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { translator } from '../../lib/i18n/translate.mjs';
import * as captcha from '../../app/lib/turnstileFailure.js';
import * as returns from '../../app/lib/authReturn.js';
const require = createRequire(import.meta.url);
function load(path, mocks) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', js)(id => id in mocks ? mocks[id] : require(id), module, module.exports);
    return module.exports;
}
export function gateHarness(ctx, overrides = {}) {
    const slots = [], effects = new Map(), events = new Map(), calls = [];
    let cursor = 0, dirty = true, tree;
    globalThis.window = { location: { origin: 'https://veyrnox.test', search: '' },
        addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) };
    globalThis.document = { activeElement: null };
    const hooks = { ...React,
        useState(initial) {
            const i = cursor++;
            if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
            return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value;
                if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }];
        },
        useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
        useCallback(fn, deps) { const i = cursor++, old = slots[i];
            if (!old || deps.some((d, j) => !Object.is(d, old.deps[j]))) slots[i] = { fn, deps };
            return slots[i].fn;
        },
        useEffect(fn, deps) { const i = cursor++, old = slots[i];
            if (!old || deps.some((d, j) => !Object.is(d, old.deps[j]))) effects.set(i, () => {
                old?.cleanup?.(); slots[i] = { deps, cleanup: fn() };
            });
        },
    };
    const api = Object.fromEntries(['signUp', 'sendMagicLink', 'resendSignupEmail', 'resendMagicLink', 'signInWithPassword'].map(name => [name, async (...args) => {
        calls.push({ name, args });
        return overrides[name] ? overrides[name](...args) : name === 'signUp' ? { needsConfirmation: true } : undefined;
    }]));
    const mocks = {
        react: hooks,
        '../app/lib/authClient.js': { ...api, getSession: () => null, onSessionChange: () => () => {} },
        '../app/lib/turnstileFailure.js': captcha,
    };
    const hook = load('../../components/useEmailResend.js', mocks);
    const Controls = load('../../components/EmailResendControls.jsx', {}).default;
    const Gate = load('../../components/AuthGate.jsx', { ...mocks,
        './useEmailResend.js': hook, './humanAuthError.js': load('../../components/humanAuthError.js', { './useEmailResend.js': hook }),
        './EmailResendControls.jsx': { __esModule: true, default: Controls },
        './PhoneOtpForm.jsx': { __esModule: true, default: 'phone-otp' },
        '../app/lib/accountLanguageClient.js': { watchAccountLanguage: () => () => {} },
        './LegalLink': { default: 'a' }, '../lib/i18n/rich': { rich: text => text },
        './I18nProvider.jsx': { useI18n: () => ({ t: translator('en'), locale: 'en' }) },
        '../app/lib/authReturn.js': returns,
        '../app/lib/passkeys.js': { passkeysSupported: () => false },
        '../app/lib/authProviders.js': { configuredProviders: () => ({}), readAuthSettings: async () => null },
        './Turnstile.jsx': { Turnstile: 'captcha', TURNSTILE_SITE_KEY: overrides.siteKey ?? 'public-test' },
        './AuthMarks.jsx': { AppleMark: 'apple', PasskeyMark: 'passkey', GoogleMark: 'google' },
    }).default;
    function nodes(node) {
        if (!React.isValidElement(node)) return [];
        if (node.type === Controls) return nodes(Controls(node.props));
        return [node, ...React.Children.toArray(node.props.children).flatMap(nodes)];
    }
    function render() {
        let n = 0;
        do {
            if (++n > 25) throw new Error('Render did not settle');
            dirty = false; cursor = 0; tree = Gate();
            for (const node of nodes(tree)) if (node.props.ref) {
                node.props.ref.current = { focus() { document.activeElement = node.type; } };
            }
            for (const effect of effects.values()) effect();
            effects.clear();
        } while (dirty);
    }
    const find = predicate => nodes(tree).find(predicate);
    const field = type => find(n => n.type === 'input' && n.props.type === type);
    const button = text => find(n => n.type === 'button' && n.props.children === text);
    const tick = async () => { await new Promise(resolve => setImmediate(resolve)); render(); };
    const submit = async () => { await find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); render(); };
    render();
    ctx.after(() => { for (const s of slots) s?.cleanup?.(); });
    return { calls, render, tick, find, field, button,
        open(mode) { events.get('veyrnox:auth-required')({ detail: { mode } }); render(); },
        email(value) { field('email').props.onChange({ target: { value } }); render(); },
        password(value) { field('password').props.onChange({ target: { value } }); render(); },
        token(value = 'fresh-captcha') { find(n => n.type === 'captcha').props.onToken(value); render(); },
        submit,
        resend: () => find(n => n.type === 'button' && n.props['aria-label']?.startsWith('Resend email to')),
        text: () => JSON.stringify(nodes(tree), (key, value) => key === 'ref' ? undefined : value),
    };
}
