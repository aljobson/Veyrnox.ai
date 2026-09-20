import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_UPLOAD_TYPES, uploadKeyFor } from '../lib/uploadSource.js';

// presignPutUrl signs content-type but NOT Content-Length, so R2 accepts an
// object of any size under a signature minted for a declared 1 KB. The range
// read is the first moment anyone sees the real size; these pin that it is
// actually checked there.

const AUTH = '11111111-2222-3333-4444-555555555555';
const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0, 0, 0, 0]);
const CFG = { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b', jurisdiction: 'eu' };
const KEY = uploadKeyFor(AUTH, 'image/png', UUID).key;
const CAP = ALLOWED_UPLOAD_TYPES['image/png'].maxBytes;

function stubFetch(total, status = 206) {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(PNG, {
        status,
        headers: total == null ? {} : { 'content-range': `bytes 0-15/${total}` },
    });
    return () => { globalThis.fetch = realFetch; };
}

const { resolveUploadedSource } = await import('../lib/resolveSource.js');

test('an object larger than its type cap is refused', async () => {
    const restore = stubFetch(CAP + 1);
    try {
        const out = await resolveUploadedSource(AUTH, KEY, CFG);
        assert.equal(out.ok, false);
        assert.equal(out.error, 'upload_too_large');
    } finally { restore(); }
});

test('a 5 GB video under a 1 KB declaration never reaches a provider', async () => {
    const restore = stubFetch(5 * 1024 * 1024 * 1024);
    try {
        assert.equal((await resolveUploadedSource(AUTH, KEY, CFG)).error, 'upload_too_large');
    } finally { restore(); }
});

test('an object at exactly the cap is allowed', async () => {
    const restore = stubFetch(CAP);
    try {
        const out = await resolveUploadedSource(AUTH, KEY, CFG);
        assert.equal(out.ok, true, 'the boundary is inclusive');
        assert.equal(out.field, 'image_url');
    } finally { restore(); }
});

test('a 206 with no parseable total is refused rather than assumed small', async () => {
    const restore = stubFetch(null, 206);
    try {
        assert.equal((await resolveUploadedSource(AUTH, KEY, CFG)).error, 'source_unreadable');
    } finally { restore(); }
});

test('ownership is still checked before any network call', async () => {
    let called = false;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { called = true; return new Response(PNG, { status: 206 }); };
    try {
        const other = '99999999-8888-7777-6666-555555555555';
        const out = await resolveUploadedSource(other, KEY, CFG);
        assert.equal(out.error, 'source_not_found');
        assert.equal(called, false, 'a key that is not ours must not cost a round trip');
    } finally { globalThis.fetch = realFetch; }
});
