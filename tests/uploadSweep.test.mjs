import test from 'node:test';
import assert from 'node:assert/strict';

const AUTH = '11111111-2222-3333-4444-555555555555';
const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CFG = { accountId: 'acc', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b', jurisdiction: 'eu' };
const NOW = new Date('2026-09-18T12:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

// The sweep takes its two R2 calls as injectable dependencies, so these
// tests exercise its rules — which keys it will touch and how many — without
// SigV4 or a network.
let deleted;
let deleteResult;

function deps(listResult) {
    deleted = [];
    deleteResult = { ok: true, status: 204 };
    return {
        now: NOW,
        list: async () => listResult,
        remove: async (key) => { deleted.push(key); return deleteResult; },
    };
}

const { sweepUploads } = await import('../lib/uploadSweep.js');

test('an upload older than the window is deleted; a fresh one is not', async () => {
    const out = await sweepUploads(CFG, deps({ ok: true, nextToken: null, objects: [
        { key: `uploads/${AUTH}/${UUID}.png`, lastModified: hoursAgo(48), size: 10 },
        { key: `uploads/${AUTH}/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.mp4`, lastModified: hoursAgo(1), size: 10 },
    ] }));
    assert.equal(out.ok, true);
    assert.equal(out.expired, 1);
    assert.equal(out.deleted, 1);
    assert.deepEqual(deleted, [`uploads/${AUTH}/${UUID}.png`]);
});

test('an object we did not mint is never deleted, however old', async () => {
    const out = await sweepUploads(CFG, deps({ ok: true, nextToken: null, objects: [
        // A generated asset that somehow sits under the prefix, and a key
        // whose extension this codebase never mints. Both must survive.
        { key: 'uploads/../fal/r1/result.png', lastModified: hoursAgo(999), size: 10 },
        { key: `uploads/${AUTH}/${UUID}.exe`, lastModified: hoursAgo(999), size: 10 },
        { key: 'uploads/not-a-uuid/x.png', lastModified: hoursAgo(999), size: 10 },
    ] }));
    assert.equal(out.expired, 0);
    assert.equal(out.deleted, 0);
    assert.deepEqual(deleted, [], 'nothing outside the minted pattern may be deleted');
});

test('the boundary is the cutoff, not a rounding of it', async () => {
    const out = await sweepUploads(CFG, deps({ ok: true, nextToken: null, objects: [
        { key: `uploads/${AUTH}/${UUID}.png`, lastModified: hoursAgo(24.01), size: 1 },
        { key: `uploads/${AUTH}/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.png`, lastModified: hoursAgo(23.99), size: 1 },
    ] }));
    assert.equal(out.deleted, 1);
    assert.ok(deleted[0].endsWith(`${UUID}.png`));
});

test('a failed delete is counted, not swallowed, and does not stop the run', async () => {
    const d = deps({ ok: true, nextToken: null, objects: [
        { key: `uploads/${AUTH}/${UUID}.png`, lastModified: hoursAgo(48), size: 1 },
        { key: `uploads/${AUTH}/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.png`, lastModified: hoursAgo(48), size: 1 },
    ] });
    d.remove = async (key) => { deleted.push(key); return { ok: false, error: 'R2 DELETE 500' }; };
    const out = await sweepUploads(CFG, d);
    assert.equal(out.failed, 2);
    assert.equal(out.deleted, 0);
    assert.equal(deleted.length, 2, 'the second delete is still attempted');
});

test('a failed list reports the fault instead of deleting nothing quietly', async () => {
    const out = await sweepUploads(CFG, deps({ ok: false, error: 'R2 LIST 403' }));
    assert.equal(out.ok, false);
    assert.equal(out.error, 'R2 LIST 403');
    assert.deepEqual(deleted, []);
});

test('one run is bounded so a large bucket cannot exhaust the Worker', async () => {
    const out = await sweepUploads(CFG, deps({ ok: true, nextToken: 'more', objects: Array.from({ length: 200 }, (_, i) => ({
        key: `uploads/${AUTH}/${String(i).padStart(8, '0')}-bbbb-cccc-dddd-eeeeeeeeeeee.png`,
        lastModified: hoursAgo(48),
        size: 1,
    })) }));
    assert.equal(out.expired, 200);
    assert.equal(out.deleted, 50, 'capped per run; the next cron picks up the rest');
    assert.equal(deleted.length, 50);
});
