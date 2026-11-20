import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    classifyExport, createSaveTracker, CURRENT_SCHEMA, EXPORT_LIBRARY_MAX_BYTES, PROJECT_MAX_BYTES, validateProjectBytes,
} from '../app/veyrnox/_lib/proEditorSaves.mjs';

const SESSION = 'a'.repeat(32);
const enc = (text) => new TextEncoder().encode(text).buffer;
const project = (schema, body = '"n":1', envelope = '') => enc(`{"format":"filmcraft.project","schema_version":${schema},"generator":"FilmCraft 0.20.1"${envelope},"project":{${body}}}`);
const sha256 = async (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const saveMsg = (name, bytes, seq, extra = {}) => ({ type: 'host:save', sessionId: SESSION, seq, engine: 1, name, saveAs: false, bytes, ...extra });

function setup({ persist, commitHead, hash } = {}) {
    const stored = [];
    const changes = [];
    const tracker = createSaveTracker({
        persist: persist || (async (c) => { stored.push(c.id); return { assetId: 'asset-' + c.id }; }),
        commitHead: commitHead || (async (_c, rev) => ({ revision: (rev ?? 0) + 1 })),
        sha256: hash || sha256, now: () => 1000, onChange: (s) => changes.push(s),
    });
    return { tracker, stored, changes };
}

test('real validation: envelope, integer schema and an object project; truncated or odd payloads are refused', () => {
    assert.deepEqual(validateProjectBytes(project(17)).ok, true);
    assert.equal(validateProjectBytes(project(17)).schemaVersion, 17);
    const truncated = enc('{"format":"filmcraft.project","schema_version":17,"project":');
    assert.deepEqual(validateProjectBytes(truncated), { ok: false, reason: 'invalid_json' });
    assert.equal(validateProjectBytes(enc('{"format":"other","schema_version":17,"project":{}}')).reason, 'invalid_format');
    assert.equal(validateProjectBytes(enc('{"format":"filmcraft.project","schema_version":"17","project":{}}')).reason, 'invalid_schema');
    assert.equal(validateProjectBytes(enc('{"format":"filmcraft.project","schema_version":1.5,"project":{}}')).reason, 'invalid_schema');
    assert.equal(validateProjectBytes(enc('{"format":"filmcraft.project","schema_version":17,"project":[]}')).reason, 'invalid_project');
    assert.equal(validateProjectBytes(enc('[1]')).reason, 'invalid_shape');
    assert.equal(validateProjectBytes(new ArrayBuffer(0)).reason, 'invalid_json');
    assert.equal(validateProjectBytes(new Uint8Array(PROJECT_MAX_BYTES + 1)).reason, 'too_large');
    assert.equal(validateProjectBytes(new Uint8Array([0xff, 0xfe, 0xfd]).buffer).reason, 'invalid_shape');
    // The content fingerprint ignores envelope metadata, whitespace-free key order of the envelope and view state.
    assert.deepEqual(validateProjectBytes(project(17, '"n":1', ',"view":{"x":1}')).projectBytes, validateProjectBytes(project(17, '"n":1')).projectBytes);
});

test('every .fcproj payload becomes an immutable candidate; backups are labelled, bytes are released once durable', async () => {
    const { tracker, stored } = setup();
    const backup = await tracker.receive(saveMsg('Cut (backup).fcproj', project(15), 1));
    const real = await tracker.receive(saveMsg('Cut.fcproj', project(CURRENT_SCHEMA), 2));
    await tracker.idle();
    const snap = tracker.snapshot();
    assert.deepEqual(snap.candidates.map((c) => [c.id, c.backup, c.state, c.asset, c.hasBytes]), [
        [backup, true, 'committed', 'asset-' + backup, false], [real, false, 'committed', 'asset-' + real, false],
    ]);
    assert.deepEqual(stored, [backup, real], 'uploads happen in receive order, one at a time');
    assert.equal(snap.candidates.every((c) => !('bytes' in c) && !('content' in c)), true, 'buffers and fingerprints never leak into UI snapshots');
});

test('a payload is guarded the moment it is received, before hashing finishes, and order follows receipt not hash speed', async () => {
    const gates = [];
    const slowFirst = async (bytes) => { const gate = new Promise((r) => gates.push(r)); await gate; return sha256(bytes); };
    const { tracker, stored } = setup({ hash: slowFirst });
    const first = tracker.receive(saveMsg('Cut.fcproj', project(CURRENT_SCHEMA, '"n":1'), 1));
    const second = tracker.receive(saveMsg('Cut.fcproj', project(CURRENT_SCHEMA, '"n":2'), 2));
    await Promise.all([first, second]);
    assert.equal(tracker.canLeave(), false, 'received but not yet hashed or stored');
    assert.equal(tracker.snapshot().candidates.length, 2);
    await new Promise((r) => setImmediate(r));
    gates.splice(0).forEach((r) => r()); // release hashing for the first candidate
    for (let i = 0; i < 6; i += 1) { await new Promise((r) => setImmediate(r)); gates.splice(0).forEach((r) => r()); }
    await tracker.idle();
    assert.deepEqual(stored, ['c1', 'c2'], 'the older save is never overtaken');
    assert.equal(tracker.suggestedHead(), 'c2');
});

test('a hash or storage failure keeps the payload for retry and keeps leaving blocked', async () => {
    let failHash = true;
    const { tracker } = setup({ hash: async (b) => { if (failHash) throw new Error('subtle crypto unavailable'); return sha256(b); } });
    const id = await tracker.receive(saveMsg('Cut.fcproj', project(CURRENT_SCHEMA), 1));
    await tracker.idle();
    const c = tracker.snapshot().candidates[0];
    assert.deepEqual([c.state, c.hasBytes], ['failed', true]);
    assert.equal(tracker.canLeave(), false);
    failHash = false;
    assert.equal(await tracker.retry(id), true);
    assert.equal(tracker.canLeave(), true);
});

test('arrival order never promotes anything: the head moves only on an explicit pick', async () => {
    const { tracker } = setup();
    const a = await tracker.receive(saveMsg('Cut.fcproj', project(15), 1));
    const b = await tracker.receive(saveMsg('Cut.fcproj', project(CURRENT_SCHEMA, '"a":1'), 2));
    await tracker.idle();
    assert.equal(tracker.suggestedHead(), b, 'only suggested');
    assert.equal(tracker.snapshot().pendingHead, null);
    assert.deepEqual(await tracker.promote(b), { ok: true, revision: 1 });
    assert.equal(tracker.suggestedHead(), null, 'the head already has this edit');
    assert.deepEqual(await tracker.promote(a), { ok: true, revision: 2 }, 'a person may still choose an older one');
});

test('suggestions need the exact current schema and compare edit content, not the whole file', async () => {
    const { tracker } = setup();
    const same = await tracker.receive(saveMsg('A.fcproj', project(CURRENT_SCHEMA, '"n":1'), 1));
    await tracker.idle();
    await tracker.promote(same);
    await tracker.receive(saveMsg('A copy.fcproj', project(CURRENT_SCHEMA, '"n":1', ',"view":{"zoom":2}'), 2));
    const newer = await tracker.receive(saveMsg('B.fcproj', project(CURRENT_SCHEMA + 1, '"n":9'), 3));
    await tracker.idle();
    assert.equal(tracker.suggestedHead(), null, 'identical edit with different view state is not a change; a newer schema is never suggested');
    assert.equal(tracker.snapshot().candidates.find((c) => c.id === newer).newer, true);
});

test('promotion is pending work: it blocks leaving until it succeeds, can be retried or abandoned', async () => {
    let attempt = 0;
    let releaseSecond;
    const { tracker } = setup({
        commitHead: async (_c, rev) => {
            attempt += 1;
            if (attempt === 1) { const e = new Error('stale'); e.code = 'revision-conflict'; throw e; }
            await new Promise((r) => { releaseSecond = r; });
            return { revision: (rev ?? 0) + 1 };
        },
    });
    const id = await tracker.receive(saveMsg('Cut.fcproj', project(CURRENT_SCHEMA), 1));
    await tracker.idle();
    assert.equal(tracker.canLeave(), true);
    assert.deepEqual(await tracker.promote(id), { ok: false, reason: 'revision-conflict' });
    assert.deepEqual(tracker.snapshot().pendingHead, { id, state: 'failed', reason: 'revision-conflict' });
    assert.equal(tracker.canLeave(), false, 'the chosen head update did not land');
    const retry = tracker.retryHead();
    assert.equal(tracker.snapshot().pendingHead.state, 'committing');
    assert.deepEqual(await tracker.promote(id), { ok: false, reason: 'busy' });
    assert.equal(tracker.canLeave(), false, 'still blocked while it is in flight');
    await new Promise((r) => setImmediate(r));
    releaseSecond();
    assert.deepEqual(await retry, { ok: true, revision: 1 });
    assert.equal(tracker.canLeave(), true);
    // abandon path
    const t2 = setup({ commitHead: async () => { throw new Error('offline'); } });
    const id2 = await t2.tracker.receive(saveMsg('Cut.fcproj', project(CURRENT_SCHEMA), 1));
    await t2.tracker.idle();
    assert.deepEqual(await t2.tracker.promote(id2), { ok: false, reason: 'commit-failed' });
    assert.equal(t2.tracker.canLeave(), false);
    t2.tracker.abandonHead();
    assert.equal(t2.tracker.canLeave(), true);
    assert.deepEqual(await t2.tracker.promote('nope'), { ok: false, reason: 'not-promotable' });
});

test('leaving is blocked by unsaved edits, an uncommitted candidate and an undelivered export', async () => {
    let fail = true;
    const { tracker } = setup({ persist: async () => { if (fail) throw new Error('offline'); return { assetId: 'x' }; } });
    assert.equal(tracker.canLeave(), true);
    tracker.setEditorDirty(true);
    assert.equal(tracker.canLeave(), false, 'unsaved edits');
    tracker.setEditorDirty(false);
    const id = await tracker.receive(saveMsg('Cut.fcproj', project(CURRENT_SCHEMA), 1));
    await tracker.idle();
    assert.equal(tracker.snapshot().candidates[0].state, 'failed');
    assert.equal(tracker.canLeave(), false, 'a failed upload still holds the only copy');
    fail = false;
    assert.equal(await tracker.retry(id), true);
    assert.equal(tracker.canLeave(), true);
    const exp = await tracker.receive(saveMsg('out.mp4', enc('x'), 2));
    assert.equal(tracker.canLeave(), false, 'an export nobody received yet');
    assert.ok(tracker.exportBytes(exp));
    tracker.markExportDelivered(exp);
    assert.equal(tracker.canLeave(), true);
    assert.equal(tracker.exportBytes(exp), null, 'the buffer is released after delivery');
});

test('edits made while an older save uploads keep the editor dirty after that upload commits', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { tracker } = setup({ persist: async () => { await gate; return { assetId: 'x' }; } });
    await tracker.receive(saveMsg('Cut.fcproj', project(CURRENT_SCHEMA), 1));
    tracker.setEditorDirty(true);
    release();
    await tracker.idle();
    assert.equal(tracker.snapshot().candidates[0].state, 'committed');
    assert.equal(tracker.canLeave(), false, 'the later edits are not covered by the committed older save');
});

test('late candidates from a retired engine and identical content are both kept; dispose releases buffers', async () => {
    const { tracker } = setup({ persist: async () => { throw new Error('offline'); } });
    await tracker.receive(saveMsg('Cut.fcproj', project(CURRENT_SCHEMA), 1, { engine: 1 }));
    await tracker.receive(saveMsg('Cut.fcproj', project(CURRENT_SCHEMA), 2, { engine: 2 }));
    await tracker.idle();
    const snap = tracker.snapshot();
    assert.equal(snap.candidates.length, 2);
    assert.deepEqual(snap.candidates.map((c) => c.engine), [1, 2]);
    assert.equal(snap.candidates.every((c) => c.hasBytes), true, 'failed ones keep their bytes for retry');
    tracker.dispose();
    assert.equal(tracker.snapshot().candidates.every((c) => !c.hasBytes), true);
    assert.equal(tracker.canLeave(), false, 'dispose frees memory but never pretends unsaved work was saved');
});

test('a truncated or fake project file is refused and cannot be retried or promoted', async () => {
    const { tracker, stored } = setup();
    const truncated = await tracker.receive(saveMsg('t.fcproj', enc('{"format":"filmcraft.project","schema_version":17,"project":'), 1));
    const fake = await tracker.receive(saveMsg('fake.fcproj', enc('hello'), 2));
    await tracker.idle();
    for (const id of [truncated, fake]) {
        const c = tracker.snapshot().candidates.find((x) => x.id === id);
        assert.deepEqual([c.state, c.valid], ['failed', false]);
        assert.equal(await tracker.retry(id), false);
        assert.deepEqual(await tracker.promote(id), { ok: false, reason: 'not-promotable' });
    }
    assert.deepEqual(stored, [], 'nothing invalid reaches storage');
});

test('export routing: only an MP4 within the Library cap is a Library candidate', () => {
    assert.deepEqual(classifyExport({ name: 'a.mp4', byteLength: 10 }), { route: 'library-candidate', reason: 'mp4-within-cap' });
    assert.equal(classifyExport({ name: 'a.MP4', byteLength: EXPORT_LIBRARY_MAX_BYTES }).route, 'library-candidate');
    assert.deepEqual(classifyExport({ name: 'a.mp4', byteLength: EXPORT_LIBRARY_MAX_BYTES + 1 }), { route: 'download', reason: 'over-library-cap' });
    assert.deepEqual(classifyExport({ name: 'captions.srt', byteLength: 5 }), { route: 'download', reason: 'not-a-library-format' });
    assert.equal(classifyExport({ name: 'a.mov', byteLength: 5 }).route, 'download');
});

test('dispose is a fence: nothing is hashed, stored, promoted or reported for a retired session', async () => {
    // during hashing
    let releaseHash;
    const hashGate = new Promise((r) => { releaseHash = r; });
    const persisted = [];
    const changes = [];
    const a = createSaveTracker({
        persist: async (c) => { persisted.push(c.id); return { assetId: 'x' }; }, commitHead: async () => ({ revision: 1 }),
        sha256: async (b) => { await hashGate; return sha256(b); }, now: () => 1, onChange: (s) => changes.push(s),
    });
    await a.receive(saveMsg('Cut.fcproj', project(CURRENT_SCHEMA), 1));
    await new Promise((r) => setImmediate(r));
    const before = changes.length;
    a.dispose();
    releaseHash();
    await a.idle();
    assert.deepEqual(persisted, [], 'persist is never called with released bytes');
    assert.equal(changes.length, before, 'no UI update after dispose');
    // during persistence and promotion
    let releasePersist;
    let releaseCommit;
    const persistGate = new Promise((r) => { releasePersist = r; });
    const commitGate = new Promise((r) => { releaseCommit = r; });
    const log = [];
    const b = createSaveTracker({
        persist: async () => { await persistGate; return { assetId: 'x' }; },
        commitHead: async () => { await commitGate; return { revision: 5 }; },
        sha256, now: () => 1, onChange: () => log.push('change'),
    });
    await b.receive(saveMsg('Cut.fcproj', project(CURRENT_SCHEMA), 1));
    for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r));
    b.dispose();
    const mark = log.length;
    releasePersist();
    await b.idle();
    assert.equal(log.length, mark, 'a persist that finishes after dispose reports nothing');
    const c = createSaveTracker({ persist: async () => ({ assetId: 'x' }), commitHead: async () => { await commitGate; return { revision: 9 }; }, sha256, now: () => 1, onChange: () => log.push('c') });
    const id = await c.receive(saveMsg('Cut.fcproj', project(CURRENT_SCHEMA), 1));
    await c.idle();
    const promotion = c.promote(id);
    c.dispose();
    const m2 = log.length;
    releaseCommit();
    assert.deepEqual(await promotion, { ok: false, reason: 'disposed' });
    assert.equal(log.length, m2, 'the head and the UI are not touched after dispose');
    // operations on a disposed tracker are refused
    assert.equal(await c.receive(saveMsg('x.fcproj', project(CURRENT_SCHEMA), 2)), null);
    assert.deepEqual(await c.promote(id), { ok: false, reason: 'disposed' });
    assert.equal(await c.retry(id), false);
});
