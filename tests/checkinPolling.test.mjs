import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createCheckinStatusReader } from '../app/veyrnox/_lib/checkinStatus.js';

for (const status of [401, 403, 404, 409, 429]) test(`web status ${status} stops reads through repeated focus/manual opens until tomorrow`, async () => {
    let clock = Date.parse('2026-10-23T12:00:00Z'), calls = 0;
    const reader = createCheckinStatusReader(async () => { calls++; throw { status, code: 'account_unavailable' }; }, () => clock);
    await reader.read();
    for (let i = 0; i < 30; i++) { clock += 60_000; await reader.read(); }
    assert.equal(calls, 1); assert.equal(reader.due(), false);
    clock += 86400000; await reader.read(); assert.equal(calls, 2);
});
for (const error of [{ status: 503 }, { code: 'network_error' }]) test(`web ${JSON.stringify(error)} retries with bounded backoff`, async () => {
    let clock = Date.parse('2026-10-23T12:00:00Z'), calls = 0;
    const reader = createCheckinStatusReader(async () => { calls++; throw error; }, () => clock);
    await reader.read();
    for (const delay of [60_000, 120_000, 240_000]) {
        const before = calls;
        clock += delay - 1; await reader.read(); assert.equal(calls, before);
        clock++; await reader.read(); assert.equal(calls, before + 1);
    }
    clock += 3600000; await reader.read(); assert.equal(calls, 4);
});
test('web status readers share in-flight work; terminal claim refusal wins over an older GET', async () => {
    let resolve, calls = 0;
    const reader = createCheckinStatusReader(() => { calls++; return new Promise(r => { resolve = r; }); });
    const a = reader.read(), b = reader.read();
    await Promise.resolve(); assert.equal(calls, 1);
    reader.stop(); resolve({ claimed_today: false });
    assert.equal(await a, null); assert.equal(await b, null);
    assert.equal(reader.due(), false);
});
test('credits entry uses host status events and never issues a GET', () => {
    let enabled, effect, reads = 0;
    const source = readFileSync('app/veyrnox/_components/CheckInHost.js', 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
    const stubs = {
        react: { useState: () => [false, value => { enabled = value; }], useEffect: callback => { effect = callback; } },
        'react/jsx-runtime': { jsx: () => null },
        '../../../components/I18nProvider': { useI18n: () => ({ t: key => key }) },
        '../../lib/authClient': { getStoredUserId: () => 'alice', onSessionChange: () => () => {} },
        '../_lib/gateway': { gatewayFetch: () => { reads++; assert.fail('entry must not fetch'); } },
        '../_lib/checkinStatus': {}, './CheckInDialog': {},
    };
    const exports = {};
    new Function('require', 'exports', output)(name => { assert.ok(name in stubs, name); return stubs[name]; }, exports);
    const previous = globalThis.window;
    globalThis.window = new EventTarget();
    let requests = 0;
    window.addEventListener('veyrnox:checkin-status-request', () => { requests++; });
    try {
        exports.CheckInEntry(); const cleanup = effect();
        assert.equal(requests, 1); assert.equal(enabled, false);
        window.dispatchEvent(new CustomEvent('veyrnox:checkin-status', { detail: { user: 'alice', status: { ok: true } } }));
        assert.equal(enabled, true);
        window.dispatchEvent(new CustomEvent('veyrnox:checkin-status', { detail: { user: 'bob', status: null } }));
        assert.equal(enabled, true);
        window.dispatchEvent(new CustomEvent('veyrnox:checkin-status', { detail: { user: 'alice', status: null } }));
        assert.equal(enabled, false); assert.equal(reads, 0); cleanup();
    } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});
