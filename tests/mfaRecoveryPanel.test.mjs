import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { translator, tOr, ENGLISH } from '../lib/i18n/translate.mjs';
import { localeTag } from '../lib/i18n/locales.mjs';
import appCopy from '../lib/i18n/messages/app/en/account-mfa.mjs';
const require = createRequire(import.meta.url);
const t = translator('en', { ...ENGLISH, ...appCopy });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const codes = ['01234-56789', 'ABCDE-FGHJK'];
const verified = [{ id: 'totp', status: 'verified' }];
function nodes(tree, match) {
    if (!React.isValidElement(tree)) return [];
    return [...(match(tree) ? [tree] : []), ...React.Children.toArray(tree.props.children).flatMap(child => nodes(child, match))];
}
function harness(ctx, { panel = false, options = {}, props = {} } = {}) {
    const slots = [], pending = new Map(); let cursor = 0, dirty = true, tree;
    let user = 'A', aal = 'aal2', factors = verified, generateCalls = 0, verifyCalls = 0, verifiedCallbacks = 0;
    const listeners = new Set();
    const hooks = { ...React,
        useState(initial) {
            const i = cursor++;
            if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
            return [slots[i], next => { const value = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(value, slots[i])) { slots[i] = value; dirty = true; } }];
        },
        useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
        useCallback(fn, deps) { const i = cursor++; const old = slots[i]; if (!old || deps.some((v,n) => !Object.is(v,old.deps[n]))) slots[i] = { fn, deps }; return slots[i].fn; },
        useEffect(fn, deps) {
            const i = cursor++, old = slots[i];
            if (!old || deps.some((v,n) => !Object.is(v,old.deps[n]))) pending.set(i, () => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
        },
    };
    const client = {
        async recoveryStatus() { return options.recoveryStatus?.() ?? { usable: 0, needs_regeneration: true }; },
        async generateRecoveryCodes() { generateCalls++; return options.generate?.() ?? { codes }; },
    };
    const auth = {
        getStoredUserId: () => user, getAal: () => aal, getMfaFreshUntil: () => null,
        onSessionChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        listFactors: async () => options.listFactors?.() ?? factors,
        enrollTotp: async () => { factors = []; return { factorId: 'totp', uri: '', secret: 'test' }; },
        verifyFactor: async () => { verifyCalls++; if (options.verify) return options.verify(); factors = verified; aal = 'aal2'; for (const listener of listeners) listener(); return aal; },
    };
    const name = panel ? 'MfaPanel' : 'RecoveryCodesPanel';
    const source = readFileSync(new URL(`../app/veyrnox/_components/${name}.js`, import.meta.url), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} };
    const mocks = { react: hooks, '../../../components/I18nProvider': { useI18n: () => ({ t, locale: 'en' }) },
        '../../../lib/i18n/translate.mjs': { tOr }, '../../../lib/i18n/locales.mjs': { localeTag },
        '../../lib/authClient.js': auth, '../../lib/mfaRecoveryClient.js': client,
        './RecoveryCodesPanel.js': { default: 'recovery-panel', __esModule: true },
    };
    new Function('require', 'module', 'exports', js)(id => mocks[id] ?? require(id), module, module.exports);
    const Component = panel ? module.exports.MfaPanel : module.exports.default;
    const inputProps = panel ? { onVerified: () => { verifiedCallbacks++; }, ...props } : {
        aal, factors, codes: null,
        onCodes: value => { inputProps.codes = value; dirty = true; },
        onSaved: () => { inputProps.codes = null; dirty = true; }, ...props,
    };
    function render() {
        let n = 0;
        do {
            assert.ok(++n < 20); dirty = false; cursor = 0; tree = Component(inputProps);
            for (const node of nodes(tree, node => node.props.ref)) node.props.ref.current ??= { focus() {} };
            const effects = [...pending.values()]; pending.clear(); effects.forEach(fn => fn());
        } while (dirty);
        return tree;
    }
    const cleanup = () => { slots.forEach(slot => slot?.cleanup?.()); };
    ctx.after(cleanup);
    return { render, cleanup, props: inputProps,
        async flush() { render(); await tick(); render(); },
        html: () => renderToStaticMarkup(render()),
        find: match => nodes(render(), match)[0],
        button(label) { return this.find(n => n.type === 'button' && n.props.children === label); },
        enter(value) { this.find(n => n.type === 'input').props.onChange({ target: { value } }); render(); },
        switchUser(value) { user = value; for (const listener of listeners) listener(); render(); },
        setFactors(value) { factors = value; },
        counts: () => ({ generateCalls, verifyCalls, verifiedCallbacks }),
    };
}

test('REC-06: backfill uses needs_regeneration even when raw unused is nonzero', async ctx => {
    const h = harness(ctx, { options: { recoveryStatus: () => ({ unused: 10, usable: 0, needs_regeneration: true }) } });
    await h.flush(); assert.match(h.html(), /current authenticator needs recovery codes/);
    assert.ok(h.button('Generate recovery codes')); assert.doesNotMatch(h.html(), /10 usable/);
});
test('generation challenges freshly, displays codes once, and waits for saved acknowledgement', async ctx => {
    const h = harness(ctx); await h.flush(); h.button('Generate recovery codes').props.onClick(); h.render(); h.enter('123456');
    await h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await h.flush();
    assert.equal(h.counts().verifyCalls, 1); assert.equal(h.counts().generateCalls, 1);
    assert.match(h.html(), /01234-56789/); assert.ok(h.button('Copy')); assert.ok(h.button('Download .txt')); assert.ok(h.button('I saved these'));
    assert.equal(h.button('Regenerate recovery codes'), undefined);
    h.button('I saved these').props.onClick(); h.render(); assert.doesNotMatch(h.html(), /01234-56789/);
});
test('REC-03: a failed fresh verification never generates and permits retry', async ctx => {
    const h = harness(ctx, { options: { verify: async () => { throw { code: 'reauth_required' }; } } });
    await h.flush(); h.button('Generate recovery codes').props.onClick(); h.enter('123456');
    await h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.equal(h.counts().generateCalls, 0); assert.match(h.html(), /Verify your authenticator again/);
});
test('delayed generation cannot display codes after an account switch or unmount', async ctx => {
    const pending = deferred(); const h = harness(ctx, { options: { generate: () => pending.promise } });
    await h.flush(); h.button('Generate recovery codes').props.onClick(); h.enter('123456');
    const request = h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await tick();
    h.switchUser('B'); h.cleanup(); pending.resolve({ codes }); await request;
    assert.equal(h.props.codes, null);
});
test('enrollment provisions codes before notifying a parent that could dismiss the panel', async ctx => {
    const h = harness(ctx, { panel: true }); h.setFactors([]); await h.flush();
    await h.button('Set up an authenticator app').props.onClick(); h.render(); h.enter('123456');
    await h.find(n => n.type === 'button' && n.props.children === 'Confirm').props.onClick(); await h.flush();
    const recovery = h.find(n => n.type === 'recovery-panel');
    assert.deepEqual(recovery.props.codes, codes); assert.equal(h.counts().generateCalls, 1); assert.equal(h.counts().verifiedCallbacks, 0);
    recovery.props.onSaved(); h.render(); assert.equal(h.counts().verifiedCallbacks, 1);
});
