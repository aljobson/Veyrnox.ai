import test from 'node:test';
import assert from 'node:assert/strict';
import { createProEditorClient, runPurgePage } from '../app/veyrnox/_lib/proEditorClient.mjs';
import { PROTOCOL } from '../pro-editor/src/protocol.mjs';

const CHILD = 'https://pro-editor.example';
const SESSION = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);

function fakeWin() {
    const listeners = new Set();
    return {
        addEventListener: (type, fn) => { if (type === 'message') listeners.add(fn); },
        removeEventListener: (type, fn) => { if (type === 'message') listeners.delete(fn); },
        deliver: (event) => { for (const fn of [...listeners]) fn(event); },
        count: () => listeners.size,
    };
}

function fakeTimers() {
    let next = 1;
    const intervals = new Map();
    const timeouts = new Map();
    return {
        setIntervalFn: (fn) => { const id = next++; intervals.set(id, fn); return id; },
        clearIntervalFn: (id) => intervals.delete(id),
        setTimeoutFn: (fn) => { const id = next++; timeouts.set(id, fn); return id; },
        clearTimeoutFn: (id) => timeouts.delete(id),
        tick: (n = 1) => { for (let i = 0; i < n; i += 1) for (const fn of [...intervals.values()]) fn(); },
        fireTimeouts: () => { for (const fn of [...timeouts.values()]) fn(); },
        active: () => intervals.size + timeouts.size,
    };
}

function setup() {
    const win = fakeWin();
    const timers = fakeTimers();
    const sent = [];
    const events = [];
    const contentWindow = { postMessage: (msg, origin) => sent.push({ msg, origin }) };
    const frame = { contentWindow };
    const client = createProEditorClient({
        win, getFrame: () => frame, childOrigin: CHILD, onEvent: (e) => events.push(e), ...timers,
    });
    const fromHost = (data, { origin = CHILD, source = contentWindow } = {}) => win.deliver({ origin, source, data });
    const host = (type, fields = {}) => ({ protocol: PROTOCOL, type, ...fields });
    return { client, win, timers, sent, events, fromHost, host, contentWindow };
}

test('connect retries hello to the exact child origin until host:started, then stops', () => {
    const t = setup();
    t.client.connect();
    t.timers.tick(2);
    assert.ok(t.sent.length >= 3);
    assert.ok(t.sent.every((s) => s.origin === CHILD && s.msg.type === 'app:hello'));
    t.fromHost(t.host('host:started', { sessionId: SESSION }));
    assert.equal(t.client.phase, 'started');
    assert.equal(t.client.sessionId, SESSION);
    const before = t.sent.length;
    t.timers.tick(3);
    assert.equal(t.sent.length, before, 'no more hellos once started');
});

test('messages from another origin or another window are ignored', () => {
    const t = setup();
    t.client.connect();
    t.fromHost(t.host('host:started', { sessionId: SESSION }), { origin: 'https://evil.example' });
    t.fromHost(t.host('host:started', { sessionId: SESSION }), { source: {} });
    assert.equal(t.client.phase, 'connecting');
    assert.equal(t.events.length, 0);
});

test('commands carry the session id; before the host started they are refused', () => {
    const t = setup();
    t.client.connect();
    assert.equal(t.client.open('a.mp4', new ArrayBuffer(1)), false);
    t.fromHost(t.host('host:started', { sessionId: SESSION }));
    const bytes = new ArrayBuffer(4);
    assert.equal(t.client.open('a.mp4', bytes), true);
    const last = t.sent.at(-1);
    assert.equal(last.msg.type, 'app:open');
    assert.equal(last.msg.sessionId, SESSION);
    assert.equal(last.msg.bytes, bytes);
    assert.equal(t.client.shutdown(), true);
    assert.equal(t.sent.at(-1).msg.type, 'app:shutdown');
});

test('events for another session are dropped; events for ours reach the listener without the protocol field', () => {
    const t = setup();
    t.client.connect();
    t.fromHost(t.host('host:started', { sessionId: SESSION }));
    t.events.length = 0;
    t.fromHost(t.host('host:dirty', { sessionId: OTHER, dirty: true }));
    assert.equal(t.events.length, 0);
    t.fromHost(t.host('host:dirty', { sessionId: SESSION, dirty: true }));
    assert.deepEqual(t.events, [{ type: 'host:dirty', sessionId: SESSION, dirty: true }]);
    t.fromHost(t.host('host:started', { sessionId: OTHER }));
    assert.equal(t.client.sessionId, SESSION, 'the negotiated session never changes mid-life');
});

test('a terminal failure or a close ends the session; malformed host messages are ignored', () => {
    const t = setup();
    t.client.connect();
    t.fromHost({ type: 'host:started' });
    t.fromHost(t.host('host:failed', { sessionId: SESSION, reason: 'engine-failed', detail: '' }));
    assert.equal(t.client.phase, 'connecting', 'a non-startup failure for an unknown session is ignored');
    t.fromHost(t.host('host:started', { sessionId: SESSION }));
    t.fromHost(t.host('host:failed', { sessionId: SESSION, reason: 'purge-failed', detail: 'x' }));
    assert.equal(t.client.phase, 'failed');
    assert.equal(t.client.open('a', new ArrayBuffer(1)), false);
});

test('a second tab: the host answers owned-elsewhere before any session, and that is reported, not a timeout', () => {
    const t = setup();
    t.client.connect();
    t.fromHost(t.host('host:failed', { sessionId: OTHER, reason: 'owned-elsewhere', detail: '' }), { origin: 'https://evil.example' });
    assert.equal(t.client.phase, 'connecting', 'only from the exact origin');
    t.fromHost(t.host('host:failed', { sessionId: OTHER, reason: 'owned-elsewhere', detail: '' }));
    assert.equal(t.client.phase, 'failed');
    assert.equal(t.events.at(-1).reason, 'owned-elsewhere');
    const before = t.sent.length;
    t.timers.tick(3);
    assert.equal(t.sent.length, before, 'hello stops');
    assert.equal(t.client.open('a', new ArrayBuffer(1)), false);
});

test('no answer after 40 hellos fails with a timeout, and dispose removes the listener and timer', () => {
    const t = setup();
    t.client.connect();
    t.timers.tick(45);
    assert.equal(t.client.phase, 'failed');
    assert.equal(t.events.at(-1).reason, 'timeout');
    const t2 = setup();
    t2.client.connect();
    t2.client.dispose();
    assert.equal(t2.win.count(), 0);
    assert.equal(t2.timers.active(), 0);
});

test('purge page: asks until it answers, removes the frame, and resolves the result', async () => {
    const win = fakeWin();
    const timers = fakeTimers();
    const posts = [];
    let removed = 0;
    const contentWindow = { postMessage: (msg, origin) => posts.push({ msg, origin }) };
    const promise = runPurgePage({
        win, childOrigin: CHILD, createFrame: (src) => { assert.equal(src, CHILD + '/purge.html'); return { contentWindow, remove: () => { removed += 1; } }; }, ...timers,
    });
    timers.tick(2);
    assert.ok(posts.length >= 2 && posts.every((p) => p.msg.type === 'app:cleanup' && p.origin === CHILD));
    win.deliver({ origin: 'https://evil.example', source: contentWindow, data: { protocol: PROTOCOL, type: 'host:cleaned', ok: true, reason: 'none' } });
    win.deliver({ origin: CHILD, source: {}, data: { protocol: PROTOCOL, type: 'host:cleaned', ok: true, reason: 'none' } });
    assert.equal(removed, 0, 'wrong origin or window does not finish it');
    win.deliver({ origin: CHILD, source: contentWindow, data: { protocol: PROTOCOL, type: 'host:cleaned', ok: false, reason: 'owned-elsewhere' } });
    assert.deepEqual(await promise, { ok: false, reason: 'owned-elsewhere' });
    assert.equal(removed, 1);
    assert.equal(win.count(), 0);
    assert.equal(timers.active(), 0);
});

test('purge page: a silent page times out and a frame that cannot be created resolves, never rejects', async () => {
    const win = fakeWin();
    const timers = fakeTimers();
    const promise = runPurgePage({ win, childOrigin: CHILD, createFrame: () => ({ contentWindow: { postMessage() {} }, remove() {} }), ...timers });
    timers.tick(1);
    timers.fireTimeouts();
    assert.deepEqual(await promise, { ok: false, reason: 'timeout' });
    const broken = await runPurgePage({ win, childOrigin: CHILD, createFrame: () => { throw new Error('no dom'); }, ...fakeTimers() });
    assert.deepEqual(broken, { ok: false, reason: 'no-frame' });
});

test('a host that starts after the hello deadline (slow storage wipe) recovers into a normal session', () => {
    const t = setup();
    t.client.connect();
    t.timers.tick(45);
    assert.equal(t.client.phase, 'failed');
    assert.equal(t.client.open('a', new ArrayBuffer(1)), false);
    t.fromHost(t.host('host:started', { sessionId: SESSION }));
    assert.equal(t.client.phase, 'started', 'late start is accepted, not stranded');
    assert.equal(t.events.at(-1).type, 'host:started');
    assert.equal(t.client.open('a.mp4', new ArrayBuffer(1)), true);
    assert.equal(t.client.shutdown(), true);
});

test('after a timeout connect() may be retried, but a real failure stays failed even if a start follows', () => {
    const t = setup();
    t.client.connect();
    t.timers.tick(45);
    const before = t.sent.length;
    t.client.connect();
    assert.equal(t.client.phase, 'connecting');
    t.timers.tick(2);
    assert.ok(t.sent.length > before, 'hellos resume');
    const u = setup();
    u.client.connect();
    u.fromHost(u.host('host:failed', { sessionId: OTHER, reason: 'owned-elsewhere', detail: '' }));
    u.fromHost(u.host('host:started', { sessionId: SESSION }));
    assert.equal(u.client.phase, 'failed', 'only a timeout is recoverable');
    u.client.connect();
    assert.equal(u.client.phase, 'failed', 'and connect() does not revive a real failure');
});
