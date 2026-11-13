import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-role' });
const root = await import('../app/api/v1/library-sync/route.js');
const fav = await import('../app/api/v1/library-sync/favourites/route.js');
const draft = await import('../app/api/v1/library-sync/draft/route.js');
const { librarySyncEnabled, cleanFavouriteBody, cleanDraftBody, readSyncBody } = await import('../lib/librarySync.js');

const auth = '11111111-1111-4111-8111-111111111111';
const job = '22222222-2222-4222-8222-222222222222';
const savedFetch = globalThis.fetch;
const savedFlag = process.env.LIBRARY_SYNC_ENABLED;
const savedErr = console.error;
let calls, logged;
test.beforeEach(() => { calls = []; logged = []; console.error = (...a) => logged.push(a.join(' ')); process.env.LIBRARY_SYNC_ENABLED = 'true'; });
test.afterEach(() => {
    globalThis.fetch = savedFetch; console.error = savedErr;
    if (savedFlag === undefined) delete process.env.LIBRARY_SYNC_ENABLED; else process.env.LIBRARY_SYNC_ENABLED = savedFlag;
});
const req = (method, body, id = auth, path = '') => new Request(`https://veyrnox.test/api/v1/library-sync${path}`, {
    method, headers: { 'content-type': 'application/json', ...(id ? { 'x-veyrnox-auth-id': id } : {}) },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
});
function stub(result = { ok: true }, { fail } = {}) {
    globalThis.fetch = async (url, init) => {
        calls.push({ name: new URL(url).pathname.split('/').pop(), args: JSON.parse(init.body) });
        if (fail) throw new Error('backend down');
        return Response.json(result);
    };
}
const good = { modelId: 'veo-3', prompt: 'a red fox', duration: 5, aspect: '16:9', count: 2, seed: '42', negative: '', voice: '' };

test('the flag is off unless it is exactly "true"', () => {
    assert.equal(librarySyncEnabled({}), false);
    assert.equal(librarySyncEnabled({ LIBRARY_SYNC_ENABLED: '1' }), false);
    assert.equal(librarySyncEnabled({ LIBRARY_SYNC_ENABLED: 'true' }), true);
});

test('no identity: refused before any outbound call, on every route', async () => {
    stub();
    for (const id of [null, '', 'not-a-uuid']) {
        assert.equal((await root.GET(req('GET', undefined, id))).status, 401);
        assert.equal((await fav.PUT(req('PUT', { job_id: job, starred: true }, id))).status, 401);
        assert.equal((await draft.PUT(req('PUT', { draft: good }, id))).status, 401);
        assert.equal((await draft.DELETE(req('DELETE', undefined, id))).status, 401);
    }
    assert.deepEqual(calls, []);
});

test('flag off: every route answers 404 and calls nothing', async () => {
    delete process.env.LIBRARY_SYNC_ENABLED; stub();
    assert.equal((await root.GET(req('GET'))).status, 404);
    assert.equal((await fav.PUT(req('PUT', { job_id: job, starred: true }))).status, 404);
    assert.equal((await draft.PUT(req('PUT', { draft: good }))).status, 404);
    assert.equal((await draft.DELETE(req('DELETE'))).status, 404);
    assert.deepEqual(calls, []);
});

test('GET returns favourites and the draft for the verified account only', async () => {
    stub({ ok: true, favourites: [job], draft: { v: 1, modelId: 'veo-3', prompt: 'p' }, draft_updated_at: '2026-11-13T10:00:00Z' });
    const res = await root.GET(req('GET'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.deepEqual(body.favourites, [job]);
    assert.equal(body.draft.prompt, 'p');
    assert.deepEqual(calls, [{ name: 'get_library_sync', args: { p_auth_id: auth } }]);
});

test('GET with nothing stored is empty, and an unknown account is 404', async () => {
    stub({ ok: true, favourites: [], draft: null, draft_updated_at: null });
    assert.deepEqual(await (await root.GET(req('GET'))).json(), { favourites: [], draft: null, draft_updated_at: null });
    stub({ ok: false, error: 'account_not_found' });
    assert.equal((await root.GET(req('GET'))).status, 404);
});

test('favourite body is exactly { job_id: uuid, starred: boolean }', async () => {
    assert.deepEqual(cleanFavouriteBody({ job_id: job.toUpperCase(), starred: false }), { ok: true, jobId: job, starred: false });
    for (const bad of [{}, { job_id: job }, { job_id: 'x', starred: true }, { job_id: job, starred: 'yes' }, { job_id: job, starred: true, user_id: auth }, null, [], 'x']) {
        assert.equal(cleanFavouriteBody(bad).ok, false, JSON.stringify(bad));
    }
    stub();
    assert.equal((await fav.PUT(req('PUT', 'not json'))).status, 400);
    assert.equal((await fav.PUT(req('PUT', { job_id: 'x', starred: true }))).status, 400);
    assert.deepEqual(calls, []);
});

test('starring calls the database with the verified id, never one from the body', async () => {
    stub({ ok: true, changed: true });
    const res = await fav.PUT(req('PUT', { job_id: job, starred: true }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { changed: true });
    assert.deepEqual(calls, [{ name: 'set_library_favourite', args: { p_auth_id: auth, p_job_id: job, p_starred: true } }]);
});

test('another account\'s job and the 201st star have their own typed errors', async () => {
    stub({ ok: false, error: 'job_not_found' });
    assert.equal((await fav.PUT(req('PUT', { job_id: job, starred: true }))).status, 404);
    stub({ ok: false, error: 'too_many_favourites' });
    const res = await fav.PUT(req('PUT', { job_id: job, starred: true }));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'too_many_favourites');
});

test('the draft keeps only the shared words-and-settings fields', () => {
    const out = cleanDraftBody({ draft: { ...good, sources: { image: { assetId: 'a' } }, idempotencyKey: 'k', file: 'x', cinema: { a: 1 }, aspect: '3:2', count: 9, duration: 'abc' }, extra: 1 });
    assert.equal(out.ok, false, 'unknown top-level key');
    const ok = cleanDraftBody({ draft: { ...good, sources: { image: { assetId: 'a' } }, idempotencyKey: 'k', file: 'x', aspect: '3:2', count: 9, duration: 'abc' } });
    assert.equal(ok.ok, true);
    assert.deepEqual(Object.keys(ok.draft).sort(), ['aspect', 'count', 'duration', 'modelId', 'negative', 'prompt', 'seed', 'v', 'voice']);
    assert.equal(ok.draft.aspect, null); assert.equal(ok.draft.count, 1); assert.equal(ok.draft.duration, null);
});

test('an empty, oversized or malformed draft is refused', () => {
    for (const bad of [
        { draft: { ...good, prompt: '  ', seed: '', negative: '', voice: '' } },
        { draft: { ...good, prompt: 'x'.repeat(30001) } },
        { draft: { ...good, modelId: 'bad id!' } },
        { draft: { ...good, prompt: 5 } },
        { draft: null }, {}, null, [], { draft: [] },
    ]) assert.equal(cleanDraftBody(bad).ok, false, JSON.stringify(bad).slice(0, 60));
});

test('PUT draft stores the cleaned draft; DELETE clears; the prompt is never logged', async () => {
    stub({ ok: true });
    assert.equal((await draft.PUT(req('PUT', { draft: { ...good, prompt: 'SECRET PROMPT', file: 'x' } }))).status, 200);
    assert.equal(calls[0].name, 'put_create_draft');
    assert.equal(calls[0].args.p_auth_id, auth);
    assert.equal(calls[0].args.p_draft.file, undefined);
    assert.equal((await draft.DELETE(req('DELETE'))).status, 200);
    assert.equal(calls[1].name, 'clear_create_draft');
    stub({ ok: true }, { fail: true });
    assert.equal((await draft.PUT(req('PUT', { draft: { ...good, prompt: 'SECRET PROMPT' } }))).status, 502);
    assert.equal(logged.some((line) => line.includes('SECRET PROMPT')), false);
});

test('readSyncBody trusts nothing from the server shape', () => {
    assert.deepEqual(readSyncBody(null), { favourites: [], draft: null, draftUpdatedAt: null });
    const out = readSyncBody({ favourites: [job, 'nope', 7], draft: { ...good, junk: 1 }, draft_updated_at: '2026-11-13T10:00:00Z' });
    assert.deepEqual(out.favourites, [job]);
    assert.equal(out.draft.junk, undefined);
});
