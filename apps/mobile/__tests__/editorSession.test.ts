import { editorReducer as reduce, initialSession, nextAction } from '../src/lib/editorSession';
import { ApiError } from '../src/lib/api';
import type { ProjectDocument } from '../src/lib/editorBridge';
const doc: ProjectDocument = { schema_version: 1, project_id: 'project', brief: '' };
function dirty() {
    let s = reduce(initialSession(), { type: 'loaded', document: doc, revision: 4 });
    s = reduce(s, { type: 'hello', protocol: 1 });
    s = reduce(s, { type: 'ready' });
    return reduce(s, { type: 'changed', document: { ...doc, brief: 'mine' }, key: 'key-1', now: 0 });
}
test('three seconds quiet, immutable snapshots, one queued follow-up', () => {
    const s = dirty();
    expect(nextAction(s, 0)).toMatchObject({ type: 'save', at: 3000, reason: 'quiet' });
    expect(reduce(s, { type: 'save', now: 2999 })).toBe(s);
    let saving = reduce(s, { type: 'save', now: 3000 });
    expect(nextAction(saving, 4000)).toBeNull();
    saving = reduce(saving, { type: 'changed', document: { ...doc, brief: 'newer' }, key: 'key-2', now: 4000 });
    expect(s.document?.brief).toBe('mine');
    const followup = reduce(saving, { type: 'saved', revision: 5 });
    expect(nextAction(followup, 7000)).toMatchObject({ at: 7000, snapshot: { key: 'key-2', revision: 5, document: { brief: 'newer' } } });
    const done = reduce(reduce(followup, { type: 'save', now: 7000 }), { type: 'saved', revision: 6 });
    expect(done.dirty).toBe(false);
    expect(nextAction(done, 9000)).toBeNull();
});
test('same snapshot retains key, a failed older request is retried before new work', () => {
    let s = dirty();
    s = reduce(s, { type: 'changed', document: { ...s.document! }, key: 'unused', now: 100 });
    expect(s.key).toBe('key-1');
    s = reduce(s, { type: 'save', now: 3000 });
    s = reduce(s, { type: 'failed', status: 0, now: 3000 });
    s = reduce(s, { type: 'changed', document: { ...doc, brief: 'new' }, key: 'key-2', now: 4000 });
    expect(nextAction(s, 8000)).toMatchObject({ snapshot: { key: 'key-1', revision: 4 } });
});
test.each([[409, 'conflict'], [404, 'unavailable'], [403, 'unavailable'], [503, 'unavailable'], [400, 'rejected']])('%s becomes %s and keeps the draft', (status, result) => {
    let s = dirty();
    s = reduce(s, { type: 'local', document: s.document!, kept: true });
    s = reduce(s, { type: 'failed', status: Number(status), now: 0 });
    expect(s.status).toBe(result); expect(s.localCopy).toBe('kept'); expect(s.dirty).toBe(true);
});
test('rate limit cannot be shortened by active, manual retry, or an offline period', () => {
    let s = reduce(dirty(), { type: 'failed', status: 0, now: 0 });
    s = reduce(s, { type: 'failed', status: 429, retryAfterSeconds: 60, now: 0 });
    for (const now of [1000, 2000, 30000, 59900]) {
        s = reduce(s, { type: 'retry', now });
        expect(nextAction(s, now)).toMatchObject({ at: 60000, reason: 'rate_limit' });
        expect(reduce(s, { type: 'save', now }).inFlight).toBe(false);
    }
    s = reduce(s, { type: 'save', now: 60000 });
    expect(s.inFlight).toBe(true); expect(nextAction(s, 60000)).toBeNull();
});
test.each([[undefined, 60000], [7, 7000], [999, 600000], [0, 1000]])('429 wait %s is clamped', (retryAfterSeconds, at) => {
    let s = reduce(dirty(), { type: 'failed', status: 429, retryAfterSeconds, now: 0 });
    s = reduce(s, { type: 'retry', now: 0 });
    expect(s.status).toBe('paused'); expect(nextAction(s, 0)?.at).toBe(at);
});
test('network ApiError preserves local copy, retries after five seconds and on active', () => {
    let s = dirty();
    s = reduce(s, { type: 'local', document: s.document!, kept: true });
    const err = new ApiError(0, 'network');
    s = reduce(s, { type: 'failed', status: err.status, now: 3000 });
    expect(s.status).toBe('offline'); expect(s.localCopy).toBe('kept');
    expect(nextAction(s, 3000)?.at).toBe(8000);
    s = reduce(s, { type: 'retry', now: 3500 });
    expect(nextAction(s, 3500)?.at).toBe(3500);
});
test('offline retries back off independently through sixty seconds', () => {
    let s = dirty(), now = 3000;
    for (const delay of [5000, 10000, 20000, 40000, 60000, 60000]) {
        s = reduce(s, { type: 'failed', status: 0, now });
        expect(s.nextRetryAt).toBe(now + delay); now += delay;
    }
});
test('protocol mismatch and content process recovery preserve the latest document', () => {
    expect(reduce(initialSession(), { type: 'hello', protocol: 2 }).status).toBe('protocol_mismatch');
    let s = reduce(dirty(), { type: 'kill', now: 1000 });
    expect(s.status).toBe('killed'); expect(nextAction(s, 1000)?.type).toBe('reopen');
    s = reduce(s, { type: 'reopen' });
    expect(s.document?.brief).toBe('mine'); expect(s.reloadKey).toBe(1);
    expect(reduce(s, { type: 'kill', now: 120999 }).status).toBe('stopped');
    expect(reduce(s, { type: 'kill', now: 122000 }).status).toBe('killed');
});

test.each([0, 429, 400])('late save failure %s cannot automatically reopen a twice-killed engine', status => {
    let s = reduce(dirty(), { type: 'save', now: 3000 });
    s = reduce(s, { type: 'kill', now: 3100 });
    s = reduce(s, { type: 'reopen' });
    s = reduce(s, { type: 'kill', now: 3200 });
    s = reduce(s, { type: 'failed', status, now: 3300 });
    expect(s.engineStopped).toBe(true); expect(s.document?.brief).toBe('mine');
    expect(s.status).toBe(status === 0 ? 'offline' : status === 429 ? 'paused' : 'rejected');
    if (status === 400) expect(nextAction(s, 90000)).toBeNull();
    else {
        expect(nextAction(s, 90000)).toMatchObject({ type: 'save' });
        s = reduce(s, { type: 'save', now: 90000 });
        s = reduce(s, { type: 'saved', revision: 5 });
        expect(s.dirty).toBe(false); expect(s.engineStopped).toBe(true); expect(s.reloadKey).toBe(1);
    }
});


test('stopping auto-reopen still permits native saving of the current draft', () => {
    let s = reduce(dirty(), { type: 'kill', now: 1000 });
    s = reduce(s, { type: 'reopen' });
    s = reduce(s, { type: 'kill', now: 2000 });
    expect(s.status).toBe('stopped');
    expect(nextAction(s, 3000)).toMatchObject({ type: 'save', at: 3000, snapshot: { document: { brief: 'mine' } } });
    s = reduce(s, { type: 'save', now: 3000 });
    expect(s.inFlight).toBe(true); expect(s.engineStopped).toBe(true);
    s = reduce(s, { type: 'saved', revision: 5 });
    expect(s.dirty).toBe(false); expect(s.engineStopped).toBe(true);
    expect(reduce(s, { type: 'reopen' }).engineStopped).toBe(false);
});
