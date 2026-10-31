import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { COUNT, CODE_LENGTH, RECOVERY_CODE_RE, generateRecoveryCodes, normalizeRecoveryCode, hashRecoveryCode } from '../lib/mfaRecovery.js';

test('ten distinct 50-bit Crockford codes, with unbiased random symbols', () => {
    assert.equal(COUNT, 10); assert.equal(CODE_LENGTH, 10);
    const batches = Array.from({ length: 100 }, () => generateRecoveryCodes());
    const all = batches.flat();
    assert.equal(all.length, 1000); assert.equal(new Set(all).size, 1000);
    for (const code of all) {
        assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
        assert.match(code, RECOVERY_CODE_RE);
    }
    assert.equal(new Set(all.join('').replaceAll('-', '')).size, 32);
    for (const count of [0, -1, 101, 1.5]) assert.throws(() => generateRecoveryCodes(count));
});
test('normalization maps ambiguous Crockford input and rejects invalid length or U', () => {
    assert.equal(normalizeRecoveryCode('oilab-cdefg'), '011ABCDEFG');
    assert.equal(normalizeRecoveryCode(' 01234 . 56789 '), '0123456789');
    for (const input of [null, 1234567890, '', '123456789', '12345678901', 'U123456789']) assert.equal(normalizeRecoveryCode(input), null);
    for (const input of ['0123456789', 'oilab-cdefg', '01234 56789']) assert.match(input, RECOVERY_CODE_RE);
    for (const input of ['U123456789', '01234.56789', '01234\n56789']) assert.equal(RECOVERY_CODE_RE.test(input), false);
});
test('HMAC-SHA256 is deterministic per user/code/pepper and matches an independent implementation', async () => {
    const user = '11111111-1111-4111-8111-111111111111';
    const hash = await hashRecoveryCode('0123456789', 'pepper', user);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, createHmac('sha256', 'pepper').update(`${user}:0123456789`).digest('hex'));
    assert.equal(hash, await hashRecoveryCode('0123456789', 'pepper', user));
    assert.notEqual(hash, await hashRecoveryCode('0123456789', 'other', user));
    assert.notEqual(hash, await hashRecoveryCode('012345678A', 'pepper', user));
    assert.notEqual(hash, await hashRecoveryCode('0123456789', 'pepper', '22222222-2222-4222-8222-222222222222'));
    await assert.rejects(hashRecoveryCode('0123456789', '', user));
    for (const id of [undefined, null, '', 123]) await assert.rejects(hashRecoveryCode('0123456789', 'pepper', id));
    for (const code of [null, '01234-56789', 'abcde12345', 'U123456789']) await assert.rejects(hashRecoveryCode(code, 'pepper', user));
});


// Exercise browser HTTP errors without establishing a real auth session.
function recoveryClient() {
    const source = readFileSync(new URL('../app/lib/mfaRecoveryClient.js', import.meta.url), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const output = { exports: {} };
    new Function('require', 'module', 'exports', js)(id => {
        assert.equal(id, './authClient.js');
        return { getStoredUserId: () => 'A', getFreshAccessToken: async () => 'test-token' };
    }, output, output.exports);
    return output.exports;
}
for (const [name, body, expected] of [
    ['HTML', '<html>Bad gateway</html>', {}], ['empty', '', {}], ['null JSON', 'null', {}],
    ['typed JSON', JSON.stringify({ error: 'recovery_incomplete' }), { code: 'recovery_incomplete', errorCode: 'recovery_incomplete' }],
    ['GoTrue-shaped JSON', JSON.stringify({ code: 502, error_code: 'upstream_error' }), { code: 502, errorCode: 'upstream_error' }],
]) test(`REV-03: ${name} HTTP failure preserves status and available error codes`, async ctx => {
    ctx.mock.method(globalThis, 'fetch', async () => new Response(body, { status: 502 }));
    await assert.rejects(recoveryClient().consumeRecoveryCode('01234-56789'), err => {
        assert.ok(err instanceof Error); assert.ok(!(err instanceof SyntaxError));
        assert.equal(err.status, 502); assert.equal(err.code, expected.code); assert.equal(err.errorCode, expected.errorCode);
        return true;
    });
});
test('REV-03: successful client response shapes and Bearer requests stay unchanged', async ctx => {
    const payloads = [{ codes: ['01234-56789'], batch_id: 'batch' }, { usable: 9 }, { recovered: true }];
    const calls = [];
    ctx.mock.method(globalThis, 'fetch', async (url, init) => {
        calls.push({ url, ...init }); return Response.json(payloads[calls.length - 1]);
    });
    const client = recoveryClient();
    assert.deepEqual(await client.generateRecoveryCodes(), payloads[0]);
    assert.deepEqual(await client.recoveryStatus(), payloads[1]);
    assert.deepEqual(await client.consumeRecoveryCode('01234-56789'), payloads[2]);
    assert.deepEqual(calls.map(c => c.method), ['POST', 'GET', 'POST']);
    assert.ok(calls.every(c => c.headers.Authorization === 'Bearer test-token'));
});
