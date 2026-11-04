import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

// A native modal dialog makes everything outside it inert and sits above all non-top-layer content. The sign-in
// (AuthGate) and two-factor (MfaSignInStepUp) prompts are ordinary fixed elements, so one that opened while a
// picker was open would be unreachable, and a request waiting on it would hang. Modal therefore steps aside while
// an element marked data-auth-prompt is on screen and reopens afterwards, keeping its React state.
const require = createRequire(import.meta.url);

function mountModal({ promptPresent = false } = {}) {
    const dialog = { open: false, calls: [], showModal() { this.open = true; this.calls.push('show'); }, close() { this.open = false; this.calls.push('close'); } };
    let prompt = promptPresent;
    const state = { observers: [] };
    class FakeObserver {
        constructor(callback) { this.callback = callback; this.disconnected = false; state.observers.push(this); }
        observe(target, options) { this.target = target; this.options = options; }
        disconnect() { this.disconnected = true; }
    }
    Object.assign(globalThis, {
        document: { activeElement: { isConnected: true, focus() { state.refocused = true; } }, body: { tag: 'body' },
            querySelector: selector => { state.selector = selector; return prompt ? { tag: 'prompt' } : null; } },
        MutationObserver: FakeObserver,
    });
    const effects = [], refs = [];
    let cursor = 0;
    const react = { useEffect: fn => effects.push(fn), useRef: initial => (refs[cursor++] ??= { current: initial }) };
    const source = readFileSync(new URL('../app/veyrnox/_components/Modal.js', import.meta.url), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', js)(id => id === 'react' ? react : id.startsWith('react/') ? { jsx: () => null, jsxs: () => null } : require(id), module, module.exports);
    module.exports.Modal({ children: null, onCancel() {} });
    refs[0].current = dialog;
    const cleanups = effects.map(effect => effect());
    return { dialog, state, setPrompt(value) { prompt = value; state.observers[0].callback(); }, unmount() { cleanups.forEach(cleanup => cleanup?.()); } };
}

test('with no prompt on screen the modal opens and watches the document', () => {
    const m = mountModal();
    assert.deepEqual(m.dialog.calls, ['show']);
    assert.equal(m.state.selector, '[data-auth-prompt]');
    assert.deepEqual(m.state.observers[0].options, { childList: true, subtree: true });
    assert.equal(m.state.observers[0].target, document.body);
});

test('a sign-in or two-factor prompt that opens later makes an open modal step aside, then come back', () => {
    const m = mountModal();
    m.setPrompt(true);
    assert.equal(m.dialog.open, false, 'the prompt must be reachable');
    m.setPrompt(true);
    assert.deepEqual(m.dialog.calls, ['show', 'close'], 'repeated mutations do not close twice');
    m.setPrompt(false);
    assert.equal(m.dialog.open, true);
    assert.deepEqual(m.dialog.calls, ['show', 'close', 'show']);
});

test('a prompt already on screen at mount keeps the modal closed until it goes away', () => {
    const m = mountModal({ promptPresent: true });
    assert.deepEqual(m.dialog.calls, []);
    m.setPrompt(false);
    assert.deepEqual(m.dialog.calls, ['show']);
});

test('unmounting stops watching, closes the dialog and returns focus', () => {
    const m = mountModal();
    m.unmount();
    assert.equal(m.state.observers[0].disconnected, true);
    assert.equal(m.dialog.open, false);
    assert.equal(m.state.refocused, true);
});

test('both prompts carry the marker the modal looks for', () => {
    for (const file of ['components/AuthGate.jsx', 'components/MfaSignInStepUp.jsx']) {
        const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.match(source, /aria-modal="true" data-auth-prompt/, file);
    }
});
