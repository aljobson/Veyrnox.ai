// Audit 2026-09-16, finding 5: outbound calls with no deadline. The JWKS fetch
// sat on the auth path of every /api/v1 request with no AbortController, so a
// Supabase edge that accepted the connection and stalled would stall every
// signed-in user behind it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout } from '../lib/fetchWithTimeout.js';

const realFetch = globalThis.fetch;
const restore = () => { globalThis.fetch = realFetch; };

test('aborts a request that never answers', async () => {
    globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    try {
        await assert.rejects(fetchWithTimeout('https://example.invalid', {}, 20), { name: 'AbortError' });
    } finally { restore(); }
});

test('passes the response straight through and keeps the caller init', async () => {
    let seen;
    globalThis.fetch = async (url, init) => { seen = { url, init }; return Response.json({ ok: true }); };
    try {
        const res = await fetchWithTimeout('https://example.invalid/x', { method: 'POST', headers: { a: 'b' } }, 1000);
        assert.deepEqual(await res.json(), { ok: true });
        assert.equal(seen.init.method, 'POST');
        assert.deepEqual(seen.init.headers, { a: 'b' });
        assert.ok(seen.init.signal, 'no abort signal was attached');
    } finally { restore(); }
});

test('does not abort a slow-but-answering request, and clears its timer', async () => {
    globalThis.fetch = async (_url, init) => {
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(init.signal.aborted, false);
        return Response.json({ late: true });
    };
    try {
        const res = await fetchWithTimeout('https://example.invalid', {}, 500);
        assert.deepEqual(await res.json(), { late: true });
    } finally { restore(); }
    // A timer left running would hold the event loop open past this test; the
    // suite finishing is the assertion.
});

test('caller cancellation stops body consumption after headers', async () => {
    let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    const mine = new AbortController();
    try {
        const pending = fetchWithTimeout('https://example.invalid', { signal: mine.signal }, 1000);
        setTimeout(() => mine.abort(), 10);
        await assert.rejects(pending, { name: 'AbortError' });
        assert.equal(cancelled, true);
    } finally { restore(); }
});

test('a stalled body is subject to the original request deadline', async () => {
    globalThis.fetch = async () => new Response(new ReadableStream({}));
    try {
        await assert.rejects(fetchWithTimeout('https://example.invalid', {}, 20), { name: 'AbortError' });
    } finally { restore(); }
});

test('response ceiling counts bytes despite a false content-length header', async () => {
    globalThis.fetch = async () => new Response('oversized', { headers: { 'content-length': '1' } });
    try {
        await assert.rejects(fetchWithTimeout('https://example.invalid', {}, 1000, 4), { status: 413 });
    } finally { restore(); }
});

// A body too large to hold is handed on piece by piece instead.
const pieces = (...parts) => new ReadableStream({
    pull(controller) { if (parts.length) controller.enqueue(new Uint8Array(parts.shift())); else controller.close(); },
}, { highWaterMark: 0 });

test('a streamed body is handed on piece by piece, with its status and size', async () => {
    const { streamWithTimeout } = await import('../lib/fetchWithTimeout.js');
    let seenInit;
    globalThis.fetch = async (_url, init) => { seenInit = init; return new Response(pieces([1, 2], [3], [4, 5, 6]), { status: 206 }); };
    try {
        const got = [];
        const res = await streamWithTimeout('https://example.invalid', { headers: { Range: 'bytes=0-5' } }, 1000, 6, (piece) => { got.push([...piece]); });
        assert.deepEqual(got, [[1, 2], [3], [4, 5, 6]]);
        assert.equal(res.status, 206);
        assert.equal(res.bytes, 6);
        assert.deepEqual(seenInit.headers, { Range: 'bytes=0-5' });
    } finally { restore(); }
});

test('a streamed body has the same ceiling and the same deadline through its last byte', async () => {
    const { streamWithTimeout } = await import('../lib/fetchWithTimeout.js');
    try {
        globalThis.fetch = async () => new Response(pieces([1, 2, 3], [4, 5, 6]));
        await assert.rejects(streamWithTimeout('https://example.invalid', {}, 1000, 5, () => {}), { status: 413 });
        globalThis.fetch = async () => new Response(new ReadableStream({}));
        await assert.rejects(streamWithTimeout('https://example.invalid', {}, 20, 5, () => {}), { name: 'AbortError' });
    } finally { restore(); }
});

test('a streamed body stops being read when its reader has seen enough', async () => {
    const { streamWithTimeout } = await import('../lib/fetchWithTimeout.js');
    let cancelled = false;
    let pulls = 0;
    globalThis.fetch = async () => new Response(new ReadableStream({
        pull(controller) { pulls += 1; controller.enqueue(new Uint8Array(10)); },
        cancel() { cancelled = true; },
    }, { highWaterMark: 0 }));
    try {
        const res = await streamWithTimeout('https://example.invalid', {}, 1000, 1000, () => false);
        assert.equal(res.bytes, 10);
        assert.equal(pulls, 1);
        assert.equal(cancelled, true);
    } finally { restore(); }
});
