import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { translator, tOr } from '../lib/i18n/translate.mjs';
import * as logic from '../app/lib/mfaStepUp.js';
import * as recoveryLogic from '../lib/mfaRecovery.js';

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('components/MfaSignInStepUp.jsx');
const tick = () => new Promise(resolve => setImmediate(resolve));
const verified = [{ id: 'totp', status: 'verified' }];
const failure = code => Object.assign(new Error('secret provider payload'), { code });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// Same transpile/component + hook-mock approach as accountRecoveryUx, with
// dependency-aware effects, stable refs, cleanup and React element event handlers.
function component(mocks) {
  const js = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const output = { exports: {} };
  new Function('require', 'module', 'exports', js)(id => mocks[id] ?? require(id), output, output.exports);
  return output.exports.default;
}
function nodes(node, predicate) {
  if (!React.isValidElement(node)) return [];
  return [...(predicate(node) ? [node] : []), ...React.Children.toArray(node.props.children).flatMap(child => nodes(child, predicate))];
}
function harness(ctx, options = {}) {
  const slots = [], pending = new Map(), listeners = new Set();
  let cursor = 0, dirty = true, tree = null;
  let aal = options.aal === undefined ? 'aal1' : options.aal;
  let pathname = options.pathname ?? '/app/library';
  let user = 'A', signOuts = 0, reloads = 0, lookups = 0, verifications = 0, clears = 0;
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const priorFocus = { focus() { document.activeElement = this; } };
  globalThis.window = { location: { reload() { reloads++; } } };
  globalThis.document = { activeElement: priorFocus };
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => {
        const value = typeof next === 'function' ? next(slots[index]) : next;
        if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; }
      }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useCallback(fn, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) slots[index] = { fn, deps };
      return slots[index].fn;
    },
    useEffect(fn, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        pending.set(index, () => {
          previous?.cleanup?.();
          slots[index] = { deps, fn, cleanup: fn() };
        });
      }
    },
  };
  const emit = (next, account = user) => {
    aal = next; user = account;
    for (const listener of listeners) listener({ user: { id: user } });
  };
  const Component = component({
    react: hooks,
    'next/navigation': { usePathname: () => pathname },
    './I18nProvider.jsx': { useI18n: () => ({ t: translator('en'), locale: 'en' }) },
    '../lib/i18n/translate.mjs': { tOr },
    '../app/lib/mfaStepUp.js': logic,
    '../lib/mfaRecovery.js': recoveryLogic,
    '../app/lib/mfaRecoveryClient.js': { consumeRecoveryCode: code => options.consumeRecoveryCode?.(code) ?? Promise.resolve({ recovered: true }) },
    '../app/lib/authClient.js': {
      getAal: () => aal,
      getStoredUserId: () => user,
      onSessionChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      listFactors() { lookups++; return options.listFactors?.() ?? Promise.resolve(verified); },
      verifyFactor(id, code) {
        verifications++;
        if (options.verifyFactor) return options.verifyFactor(id, code, emit);
        emit('aal2'); // synchronous adoption BEFORE returning the resolved promise
        return Promise.resolve('aal2');
      },
      async signOut() { signOuts++; if (options.signOut) return options.signOut(emit); emit(null); },
      clearSession() { clears++; emit(null); },
    },
  });
  function render() {
    let renders = 0;
    do {
      assert.ok(++renders < 20, 'effects must settle');
      dirty = false; cursor = 0; tree = Component();
      for (const node of nodes(tree, n => n.props.ref)) {
        const ref = node.props.ref;
        if (!ref.current) ref.current = {
          focus() { document.activeElement = this; },
          querySelectorAll() { return nodes(tree, n => ['button', 'input'].includes(n.type) && !n.props.disabled).map(n => n.props.ref?.current ?? { focus() { document.activeElement = this; } }); },
        };
      }
      const effects = [...pending.values()]; pending.clear(); effects.forEach(fn => fn());
    } while (dirty);
    return tree;
  }
  function cleanup() { for (const slot of slots) slot?.cleanup?.(); }
  ctx.after(() => {
    cleanup();
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  });
  const find = predicate => nodes(render(), predicate)[0];
  return {
    render, emit, cleanup, priorFocus,
    async flush() { render(); await tick(); render(); },
    html() { return renderToStaticMarkup(render()); },
    input: () => find(n => n.type === 'input'),
    verify: () => find(n => n.props.type === 'submit'),
    enter(value) { this.input().props.onChange({ target: { value } }); render(); },
    submit() { return find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); },
    cancel(close = false) { find(n => n.type === 'button' && (close ? n.props['aria-label'] === 'Close' : n.props.children === 'Use a different account')).props.onClick(); render(); },
    dialog: () => find(n => n.props.role === 'dialog'),
    navigate(path) { pathname = path; render(); },
    replayEffects() { cleanup(); for (const slot of slots) if (slot?.fn && slot?.cleanup) slot.cleanup = slot.fn(); },
    find,
    counts: () => ({ signOuts, reloads, lookups, verifications, clears, listeners: listeners.size }),
  };
}

test('aal1 with verified TOTP opens an accessible translated prompt', async ctx => {
  const h = harness(ctx);
  assert.equal(h.render(), null);
  await h.flush();
  assert.match(h.html(), /role="dialog" aria-modal="true" aria-label="Two-factor authentication"/);
  assert.match(h.html(), /Verify and continue/);
  assert.match(h.html(), /Use a recovery code instead/);
  assert.match(h.html(), /support@veyrnox\.com/);
  assert.equal(h.input().props.inputMode, 'numeric');
  assert.equal(h.input().props.autoComplete, 'one-time-code');
  assert.equal(h.input().props.maxLength, 6);
  assert.equal(h.verify().props.disabled, true);
  assert.equal(document.activeElement, h.input().props.ref.current);
  h.enter(' 123456 ');
  assert.equal(h.input().props.value, '123456');
  assert.equal(h.verify().props.disabled, false);
});

for (const [name, options] of [
  ['no verified factor', { listFactors: async () => [{ status: 'unverified' }] }],
  ['no factors', { listFactors: async () => [] }],
  ['aal2', { aal: 'aal2' }], ['signed out', { aal: null }],
]) test(`${name} renders nothing`, async ctx => {
  const h = harness(ctx, options); await h.flush(); assert.equal(h.render(), null);
});

test('MFA-04/05: synchronous aal2 observer closes without a workspace reload', async ctx => {
  const h = harness(ctx); await h.flush(); h.enter('123456');
  const request = h.submit();
  // The observer must already have closed the prompt before submit resumes.
  assert.equal(h.render(), null);
  await request;
  assert.equal(h.render(), null);
  assert.equal(document.activeElement, h.priorFocus);
  assert.equal(h.counts().reloads, 0);
  assert.equal(h.counts().verifications, 1);
});

test('only six ASCII digits can submit', async ctx => {
  const h = harness(ctx); await h.flush();
  for (const code of ['', '12345', '1234567', 'abcdef', '１２３４５６', '١٢٣٤٥٦']) {
    h.enter(code); assert.equal(h.verify().props.disabled, true);
    await h.submit();
  }
  assert.equal(h.counts().verifications, 0);
});

for (const [code, text] of [
  ['mfa_verification_failed', /That code didn&#x27;t match/],
  ['mfa_challenge_expired', /That code expired/],
  ['over_request_rate_limit', /Wait a minute/],
  ['unknown_private_code', /That code didn&#x27;t work/],
]) test(`failed ${code} is translated, clears the code and permits retry`, async ctx => {
  const h = harness(ctx, { verifyFactor: async () => { throw failure(code); } });
  await h.flush(); h.enter('123456'); await h.submit();
  assert.match(h.html(), /role="alert"/); assert.match(h.html(), text);
  assert.doesNotMatch(h.html(), /secret provider payload|unknown_private_code/);
  assert.equal(h.input().props.value, ''); assert.equal(h.input().props.disabled, false);
  h.enter('654321'); assert.equal(h.verify().props.disabled, false);
});

test('non-aal2 result is a failed attempt and concurrent submit runs once', async ctx => {
  const request = deferred();
  const h = harness(ctx, { verifyFactor: () => request.promise });
  await h.flush(); h.enter('123456');
  const first = h.submit(); await h.submit();
  assert.equal(h.counts().verifications, 1);
  assert.equal(h.verify().props.disabled, true); assert.match(h.html(), /Working/);
  request.resolve('aal1'); await first;
  assert.match(h.html(), /role="alert"/); assert.equal(h.input().props.disabled, false);
});

for (const completion of ['aal2', 'cancel']) test(`MFA-01: delayed factors cannot reopen after ${completion}`, async ctx => {
  const lookup = deferred(); let calls = 0;
  const h = harness(ctx, { listFactors: () => ++calls === 1 ? lookup.promise : Promise.resolve(verified) });
  await h.flush();
  assert.equal(h.render(), null);
  // The second lookup opens a real prompt while the first remains outstanding.
  h.emit('aal1');
  await h.flush(); h.enter('123456');
  if (completion === 'aal2') await h.submit();
  else h.cancel();
  lookup.resolve(verified); await h.flush();
  assert.equal(h.render(), null); assert.equal(h.counts().reloads, 0);
});

test('MFA-01: cleanup invalidates a pending lookup', async ctx => {
  const lookup = deferred();
  const h = harness(ctx, { listFactors: () => lookup.promise });
  await h.flush(); h.cleanup();
  lookup.resolve(verified); await h.flush();
  assert.equal(h.render(), null); assert.equal(h.counts().listeners, 0);
});

test('MFA-03: five failures lock this sign-in; fresh same-account sign-in resets it', async ctx => {
  const h = harness(ctx, { verifyFactor: async () => { throw failure('mfa_verification_failed'); } });
  await h.flush();
  for (let i = 0; i < logic.MAX_ATTEMPTS; i++) { h.enter('123456'); await h.submit(); }
  assert.equal(h.input().props.disabled, true); assert.equal(h.verify().props.disabled, true);
  assert.match(h.html(), /Too many attempts. Use a different account to start sign-in again/);
  assert.doesNotMatch(h.html(), /Wait a minute/);
  await h.submit(); assert.equal(h.counts().verifications, logic.MAX_ATTEMPTS);
  h.cancel(); h.emit('aal1', 'A'); await h.flush();
  assert.equal(h.input().props.disabled, false); assert.doesNotMatch(h.html(), /role="alert"/);
  h.enter('123456'); await h.submit();
  assert.equal(h.input().props.disabled, false);
});

for (const action of ['different account', 'close', 'Escape']) test(`abandon using ${action} signs out without reload`, async ctx => {
  const h = harness(ctx); await h.flush();
  if (action === 'Escape') h.dialog().props.onKeyDown({ key: 'Escape', preventDefault() {} });
  else h.cancel(action === 'close');
  await h.flush(); assert.equal(h.render(), null);
  assert.equal(h.counts().signOuts, 1); assert.equal(h.counts().reloads, 0);
});

for (const account of ['A', 'B']) for (const staleResult of ['rejection', 'account_changed', 'aal1']) {
  test(`MFA-06: stale ${staleResult} cannot alter fresh account ${account}'s challenge`, async ctx => {
    const request = deferred(); let requests = 0;
    const h = harness(ctx, { verifyFactor: () => ++requests === 1 ? request.promise : Promise.reject(failure('mfa_verification_failed')) });
    await h.flush(); h.enter('123456'); const stale = h.submit();
    h.cancel(); h.emit('aal1', account); await h.flush();
    h.enter('654321'); const before = h.html();
    if (staleResult === 'aal1') request.resolve('aal1');
    else request.reject(failure(staleResult === 'account_changed' ? 'account_changed' : 'mfa_verification_failed'));
    await stale;
    assert.equal(h.html(), before);
    // Prove the stale attempt did not consume the new challenge's allowance.
    for (let i = 0; i < logic.MAX_ATTEMPTS - 1; i++) { h.enter('654321'); await h.submit(); }
    assert.equal(h.input().props.disabled, false);
    h.enter('654321'); await h.submit(); assert.equal(h.input().props.disabled, true);
  });
}

test('MFA-06: stale A failure cannot clear B busy state or allow a duplicate request', async ctx => {
  const first = deferred(), second = deferred(); let requests = 0;
  const h = harness(ctx, { verifyFactor: () => ++requests === 1 ? first.promise : second.promise });
  await h.flush(); h.enter('123456'); const pendingA = h.submit();
  h.cancel(); h.emit('aal1', 'B'); await h.flush();
  h.enter('654321'); const pendingB = h.submit(); const before = h.html();
  first.reject(failure('mfa_verification_failed')); await pendingA;
  assert.equal(h.html(), before);
  assert.equal(h.verify().props.disabled, true);
  await h.submit(); assert.equal(requests, 2);
  second.reject(failure('mfa_challenge_expired')); await pendingB;
  assert.match(h.html(), /That code expired/);
  assert.equal(h.input().props.disabled, false);
});

test('callback owns establishment; destination navigation evaluates the session', async ctx => {
  const h = harness(ctx, { pathname: '/auth/callback/' });
  await h.flush(); assert.equal(h.render(), null); assert.equal(h.counts().lookups, 0);
  assert.equal(h.counts().listeners, 0);
  h.navigate('/app/library'); await h.flush(); assert.ok(h.input());
});

test('factor lookup outage fails open and logs no provider payload', async ctx => {
  const logs = [];
  ctx.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  const h = harness(ctx, { listFactors: async () => { throw failure('private'); } });
  await h.flush(); assert.equal(h.render(), null); assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /secret|private/);
});

test('Tab wraps at both dialog boundaries', async ctx => {
  const h = harness(ctx); await h.flush();
  const dialog = h.dialog(), first = { focus() { document.activeElement = this; } }, last = { focus() { document.activeElement = this; } };
  dialog.props.ref.current.querySelectorAll = () => [first, last];
  let prevented = 0;
  document.activeElement = last;
  dialog.props.onKeyDown({ key: 'Tab', shiftKey: false, preventDefault() { prevented++; } });
  assert.equal(document.activeElement, first);
  dialog.props.onKeyDown({ key: 'Tab', shiftKey: true, preventDefault() { prevented++; } });
  assert.equal(document.activeElement, last); assert.equal(prevented, 2);
});

test('StrictMode cleanup invalidates old lookups and keeps one subscription', async ctx => {
  const old = deferred(); let calls = 0;
  const h = harness(ctx, { listFactors: () => ++calls === 1 ? old.promise : Promise.resolve([]) });
  h.render(); h.replayEffects(); await h.flush();
  old.resolve(verified); await h.flush();
  assert.equal(h.render(), null); assert.equal(h.counts().listeners, 1);
});

test('MFA-R1: same-account session churn keeps the prompt, attempts and error', async ctx => {
  const h = harness(ctx, { verifyFactor: async () => { throw failure('mfa_verification_failed'); } });
  await h.flush();
  for (let i = 0; i < 2; i++) { h.enter('123456'); await h.submit(); }
  const lookupsBefore = h.counts().lookups;
  assert.match(h.html(), /role="alert"/);
  // A token refresh or cross-tab metadata write re-fires onSessionChange with the same aal1
  // account. It must not reopen, re-lookup, or reset the attempt count and error.
  h.emit('aal1', 'A'); await h.flush();
  assert.ok(h.input());
  assert.equal(h.counts().lookups, lookupsBefore);
  assert.match(h.html(), /role="alert"/);
  // Three more failures reach the lock, proving attempts were never reset to zero.
  for (let i = 0; i < logic.MAX_ATTEMPTS - 2; i++) { h.enter('123456'); await h.submit(); }
  assert.equal(h.input().props.disabled, true);
});

test('MFA-R2: GoTrue error_code with a numeric code maps to the specific message', async ctx => {
  const h = harness(ctx, { verifyFactor: async () => { throw Object.assign(new Error('secret provider payload'), { code: 422, errorCode: 'mfa_verification_failed' }); } });
  await h.flush(); h.enter('123456'); await h.submit();
  assert.match(h.html(), /That code didn&#x27;t match/);
  assert.doesNotMatch(h.html(), /That code didn&#x27;t work/);
  assert.doesNotMatch(h.html(), /secret provider payload/);
});

test('MFA-R3: a rejected sign-out resets the guard and hard-clears instead of wedging', async ctx => {
  const logs = [];
  ctx.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  const h = harness(ctx, { signOut: async () => { throw new Error('offline'); } });
  await h.flush();
  h.cancel(); await h.flush();
  assert.equal(h.counts().signOuts, 1);
  assert.equal(h.counts().clears, 1);
  // The gate is not left suppressed: a fresh aal1 session reopens the prompt.
  h.emit('aal1', 'A'); await h.flush();
  assert.ok(h.input());
});

test('MFA-R4: focus returns to the field after a failure and to cancel at lockout', async ctx => {
  const h = harness(ctx, { verifyFactor: async () => { throw failure('mfa_verification_failed'); } });
  await h.flush();
  h.enter('123456'); await h.submit();
  assert.equal(document.activeElement, h.input().props.ref.current);
  for (let i = 0; i < logic.MAX_ATTEMPTS - 1; i++) { h.enter('123456'); await h.submit(); }
  const cancelButton = h.find(n => n.type === 'button' && n.props.children === 'Use a different account');
  assert.equal(document.activeElement, cancelButton.props.ref.current);
});

test('root mounts immediately after AuthGate; visible source copy uses public lookups', () => {
  assert.match(read('app/layout.js'), /<AuthGate \/>\s*<MfaSignInStepUp \/>/);
  assert.doesNotMatch(source, /location\.reload|@supabase\/supabase-js/);
  const ast = ts.createSourceFile('MfaSignInStepUp.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  function check(node) {
    if (ts.isJsxText(node)) assert.equal(node.text.trim(), '', 'no visible JSX literals');
    if (ts.isJsxAttribute(node) && ['aria-label', 'title', 'placeholder'].includes(node.name.text)) {
      assert.ok(ts.isJsxExpression(node.initializer));
      assert.match(node.initializer.expression.getText(ast), /^t\((?:'authGate\.|recovery \? 'authGate\.)/);
    }
    if (ts.isJsxExpression(node) && node.expression) {
      assert.ok(!ts.isStringLiteral(node.expression), 'no raw string expressions');
    }
    ts.forEachChild(node, check);
  }
  check(ast);
});

function recoveryMode(h) {
  h.find(n => n.type === 'button' && n.props.children === 'Use a recovery code instead').props.onClick();
  h.render(); h.enter('01234-56789');
}
test('REC-01: recovery switches input and closes after a fresh factor read without aal2 or reload', async ctx => {
  let factors = verified;
  const h = harness(ctx, { listFactors: async () => factors, consumeRecoveryCode: async () => { factors = []; return { recovered: true }; } });
  await h.flush(); recoveryMode(h);
  assert.equal(h.input().props.maxLength, 11); assert.equal(h.input().props.inputMode, 'text');
  await h.submit(); h.render();
  assert.equal(h.dialog(), undefined); assert.equal(h.counts().lookups, 2); assert.equal(h.counts().reloads, 0);
  assert.match(h.html(), /Account recovered/); assert.match(h.html(), /href="\/app\/account"/);
});
test('REC-04: stale code or remaining verified factor keeps the prompt open', async ctx => {
  let stale = true;
  const h = harness(ctx, { consumeRecoveryCode: async () => stale ? { stale: true, recovered: false } : { recovered: true } });
  await h.flush(); recoveryMode(h); await h.submit();
  assert.ok(h.dialog()); assert.match(h.html(), /previous authenticator/);
  stale = false; h.enter('01234-56789'); await h.submit();
  assert.ok(h.dialog()); assert.match(h.html(), /previous authenticator/);
});
test('invalid recovery attempts share the TOTP lockout and toggling cannot reset it', async ctx => {
  const h = harness(ctx, { consumeRecoveryCode: async () => { throw failure('invalid_recovery_code'); } });
  await h.flush(); recoveryMode(h);
  for (let i = 0; i < 5; i++) { h.enter('01234-56789'); await h.submit(); }
  assert.equal(h.input().props.disabled, true); assert.match(h.html(), /Too many attempts/);
  assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Use my authenticator instead').props.disabled, true);
});
for (const action of ['cancel', 'account switch', 'close', 'Escape']) {
  test(`REC-01: delayed recovery success after ${action} cannot close or alter a new challenge`, async ctx => {
    const request = deferred();
    const h = harness(ctx, { consumeRecoveryCode: () => request.promise });
    await h.flush(); recoveryMode(h); const pending = h.submit();
    if (action === 'Escape') h.dialog().props.onKeyDown({ key: 'Escape', preventDefault() {} });
    else if (action !== 'account switch') h.cancel(action === 'close');
    h.emit('aal1', 'B'); await h.flush(); const before = h.html();
    request.resolve({ recovered: true }); await pending;
    assert.equal(h.html(), before); assert.ok(h.dialog());
    assert.equal(h.counts().signOuts, action === 'account switch' ? 0 : 1);
  });
}
test('REC-01: delayed completion lookup cannot close the next account prompt', async ctx => {
  const lookup = deferred(); let lookups = 0;
  const h = harness(ctx, { listFactors: () => ++lookups === 2 ? lookup.promise : Promise.resolve(verified) });
  await h.flush(); recoveryMode(h); const pending = h.submit(); await tick();
  h.emit('aal1', 'B'); await h.flush(); const before = h.html();
  lookup.resolve([]); await pending; assert.equal(h.html(), before); assert.ok(h.dialog());
});
test('server lockout immediately locks recovery UI', async ctx => {
  const h = harness(ctx, { consumeRecoveryCode: async () => { throw failure('recovery_rate_limited'); } });
  await h.flush(); recoveryMode(h); await h.submit(); assert.equal(h.input().props.disabled, true);
});

for (const failures of [1, 2]) test(`REV-01: ${failures} post-recovery read failure(s) never offer a burned-code retry`, async ctx => {
  let reads = 0;
  const h = harness(ctx, { listFactors: async () => {
    if (++reads === 1) return verified;
    if (reads <= failures + 1) throw failure('offline');
    return [];
  } });
  await h.flush(); recoveryMode(h); await h.submit();
  assert.equal(h.dialog(), undefined); assert.equal(h.input(), undefined); assert.equal(reads, 3);
  assert.match(h.html(), failures === 2 ? /Recovery completed. Refresh the page/ : /Account recovered/);
  assert.doesNotMatch(h.html(), /Recovery failed/); assert.equal(h.counts().reloads, 0);
  const before = h.html(); h.emit('aal1', 'A'); await h.flush();
  assert.equal(h.html(), before, 'same-account token refresh preserves completion'); assert.equal(reads, 3);
  h.emit(null); await h.flush(); assert.equal(h.render(), null, 'sign-out clears completion');
});
test('REV-01: account switch clears the recovery success notice', async ctx => {
  let reads = 0;
  const h = harness(ctx, { listFactors: async () => ++reads === 2 ? [] : verified });
  await h.flush(); recoveryMode(h); await h.submit(); assert.match(h.html(), /Account recovered/);
  h.emit('aal1', 'B'); await h.flush(); assert.ok(h.dialog()); assert.doesNotMatch(h.html(), /Account recovered/);
});
test('REV-01: retry failure after account switch cannot complete the next challenge', async ctx => {
  const retry = deferred(); let reads = 0;
  const h = harness(ctx, { listFactors: async () => {
    reads++; if (reads === 2) throw failure('offline');
    return reads === 3 ? retry.promise : verified;
  } });
  await h.flush(); recoveryMode(h); const request = h.submit(); await tick();
  h.emit('aal1', 'B'); await h.flush(); const before = h.html();
  retry.reject(failure('offline')); await request; assert.equal(h.html(), before); assert.ok(h.dialog());
});

test('REV-A: the recovery prompt retains the translated support fallback in all eleven locales', async ctx => {
  const h = harness(ctx); await h.flush();
  assert.match(h.html(), /Use a recovery code instead/); assert.match(h.html(), /support@veyrnox\.com/);
  recoveryMode(h); assert.match(h.html(), /support@veyrnox\.com/);
  assert.ok(h.find(n => n.type === 'p' && n.props.children === translator('en')('authGate.mfa.lostAccess')));
  for (const locale of ['en', 'ar', 'de', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh']) {
    const catalog = (await import(`../lib/i18n/messages/${locale}.mjs`)).default;
    assert.match(catalog['authGate.mfa.lostAccess'], /support@veyrnox\.com/, locale);
  }
});
