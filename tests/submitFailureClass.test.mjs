import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySubmitFailure, SUBMIT_FAILURE_CODES } from '../lib/submitFailureClass.js';
import { readFileSync } from 'node:fs';

// createErrors.js uses bundler-style imports, so read the source, like createAutoShort.test.mjs.
const errorCopy = readFileSync(new URL('../app/veyrnox/_lib/createErrors.js', import.meta.url), 'utf8');

const VENDOR_TEXT = 'fal 422: {"detail":"Prompt flagged by content policy"}';

function jevAnswers(choice, p) {
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        calls.push(JSON.parse(init.body));
        return Response.json({ answers: { cause: { type: 'choice', choice, probabilities: { [choice]: p }, confidence: p } } });
    };
    return { calls, restore: () => { globalThis.fetch = real; } };
}

async function withLogs(fn) {
    const logs = [];
    const errors = console.error;
    console.error = (...args) => logs.push(args.join(' '));
    try { return { result: await fn(), logs }; } finally { console.error = errors; }
}

const env = (mode) => ({ JEV_SUBMIT_ERRORS_MODE: mode, TYPESAFE_API_KEY: 'k' });

test('off (or unset) makes no request', async () => {
    const net = jevAnswers('content_policy', 0.99);
    try {
        assert.equal(await classifySubmitFailure(VENDOR_TEXT, env('off')), null);
        assert.equal(await classifySubmitFailure(VENDOR_TEXT, { TYPESAFE_API_KEY: 'k' }), null);
        assert.equal(net.calls.length, 0);
    } finally { net.restore(); }
});

test('enforce maps a confident label to its typed code', async () => {
    for (const [label, code] of Object.entries(SUBMIT_FAILURE_CODES)) {
        const net = jevAnswers(label, 0.95);
        try {
            const { result } = await withLogs(() => classifySubmitFailure(VENDOR_TEXT, env('enforce')));
            assert.equal(result, code);
            assert.equal(net.calls[0].state, VENDOR_TEXT);
        } finally { net.restore(); }
    }
});

test('enforce keeps the generic code for "other" or a low-probability label', async () => {
    for (const [label, p] of [['other', 0.99], ['content_policy', 0.6]]) {
        const net = jevAnswers(label, p);
        try {
            const { result } = await withLogs(() => classifySubmitFailure(VENDOR_TEXT, env('enforce')));
            assert.equal(result, null);
        } finally { net.restore(); }
    }
});

test('shadow asks and logs the label but never changes the code', async () => {
    const net = jevAnswers('content_policy', 0.99);
    try {
        const { result, logs } = await withLogs(() => classifySubmitFailure(VENDOR_TEXT, env('shadow')));
        assert.equal(result, null);
        assert.equal(net.calls.length, 1);
        assert.match(logs.join('\n'), /"mode":"shadow","label":"content_policy","p":0.99/);
    } finally { net.restore(); }
});

test('the log carries the label, never the vendor text', async () => {
    const net = jevAnswers('content_policy', 0.99);
    try {
        const { logs } = await withLogs(() => classifySubmitFailure(VENDOR_TEXT, env('enforce')));
        assert.ok(!logs.join('\n').includes('flagged by content policy'));
    } finally { net.restore(); }
});

test('only a provider answer is sent: never transport errors, local validation strings or non-strings', async () => {
    const net = jevAnswers('content_policy', 0.99);
    try {
        for (const text of ['transport: connection reset', 'inputs_invalid:prompt', 'duration_not_supported',
            'kie did not return a taskId', '', undefined, null, { msg: 'x' }]) {
            assert.equal(await classifySubmitFailure(text, env('enforce')), null);
        }
        assert.equal(net.calls.length, 0);
        await withLogs(() => classifySubmitFailure('kie 400/422: prompt violates policy', env('enforce')));
        assert.equal(net.calls.length, 1);
    } finally { net.restore(); }
});

test('a missing env or an unexpected answer shape never throws', async () => {
    assert.equal(await classifySubmitFailure(VENDOR_TEXT, undefined), null);
    const real = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ answers: { cause: { type: 'choice', choice: 'content_policy' } } });
    try {
        const { result } = await withLogs(() => classifySubmitFailure(VENDOR_TEXT, env('enforce')));
        assert.equal(result, null);
    } finally { globalThis.fetch = real; }
});

test('a Jev outage keeps the generic code', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async () => new Response('down', { status: 503 });
    try {
        const { result } = await withLogs(() => classifySubmitFailure(VENDOR_TEXT, env('enforce')));
        assert.equal(result, null);
    } finally { globalThis.fetch = real; }
});

test('every code the classifier or adapters emit has create-page copy', () => {
    for (const code of [...Object.values(SUBMIT_FAILURE_CODES), 'provider_submit_failed']) {
        assert.match(errorCopy, new RegExp(`^  ${code}:\\s*'`, 'm'), code);
    }
});
