import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, confidentChoice, jevMode, JEV_API_BASE, JEV_MODEL } from '../lib/jev.js';

const questions = { cause: { type: 'choice', instructions: 'Why?', criteria: { a: null, b: null } } };

function fakeFetch(respond) {
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        return respond(init);
    };
    return { calls, restore: () => { globalThis.fetch = real; } };
}

function quiet(fn) {
    const errors = console.error;
    console.error = () => {};
    return fn().finally(() => { console.error = errors; });
}

test('posts the pinned model, the state and the questions to the fixed host', async () => {
    const net = fakeFetch(() => Response.json({ model: JEV_MODEL, answers: { cause: { type: 'choice', choice: 'a' } } }));
    try {
        const answers = await decide({ apiKey: 'k', state: 'boom', questions });
        assert.deepEqual(answers, { cause: { type: 'choice', choice: 'a' } });
        assert.equal(net.calls[0].url, `${JEV_API_BASE}/v1/systemone`);
        assert.equal(net.calls[0].init.headers.Authorization, 'Bearer k');
        assert.deepEqual(JSON.parse(net.calls[0].init.body), { model: 'jev-1.13.0', state: 'boom', questions });
    } finally { net.restore(); }
});

test('a long string state is cut to 4000 characters', async () => {
    const net = fakeFetch(() => Response.json({ answers: {} }));
    try {
        await decide({ apiKey: 'k', state: 'x'.repeat(5000), questions });
        assert.equal(JSON.parse(net.calls[0].init.body).state.length, 4000);
    } finally { net.restore(); }
});

test('no API key means no request and null', async () => {
    const net = fakeFetch(() => { throw new Error('must not be called'); });
    try {
        assert.equal(await decide({ apiKey: undefined, state: 's', questions }), null);
        assert.equal(net.calls.length, 0);
    } finally { net.restore(); }
});

test('every failure is null, never a throw', async () => {
    const failures = [
        () => new Response('overloaded', { status: 529 }),
        () => new Response('not json', { status: 200 }),
        () => Response.json({ model: JEV_MODEL }),
        () => { throw new TypeError('network down'); },
    ];
    for (const respond of failures) {
        const net = fakeFetch(respond);
        try {
            await quiet(async () => assert.equal(await decide({ apiKey: 'k', state: 's', questions }), null));
        } finally { net.restore(); }
    }
});

test('a request that outlives the timeout is aborted and null', async () => {
    const net = fakeFetch((init) => new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    try {
        await quiet(async () => assert.equal(await decide({ apiKey: 'k', state: 's', questions, timeoutMs: 10 }), null));
    } finally { net.restore(); }
});

test('jevMode accepts only off, shadow and enforce', () => {
    assert.equal(jevMode('shadow'), 'shadow');
    assert.equal(jevMode('enforce'), 'enforce');
    for (const v of [undefined, '', 'on', 'true', 'ENFORCE']) assert.equal(jevMode(v), 'off');
});

test('confidentChoice needs an allowed option at or above the threshold', () => {
    const answer = (choice, p) => ({ type: 'choice', choice, probabilities: { [choice]: p } });
    assert.deepEqual(confidentChoice(answer('a', 0.9), ['a'], 0.8), { choice: 'a', probability: 0.9 });
    assert.equal(confidentChoice(answer('a', 0.79), ['a'], 0.8), null);
    assert.equal(confidentChoice(answer('other', 0.99), ['a'], 0.8), null);
    assert.equal(confidentChoice({ type: 'noul', noul: 1 }, ['a'], 0.8), null);
    assert.equal(confidentChoice(undefined, ['a'], 0.8), null);
});
