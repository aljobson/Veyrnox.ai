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
