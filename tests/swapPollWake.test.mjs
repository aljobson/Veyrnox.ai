import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForPoll } from '../app/veyrnox/_lib/templateSwapActions.mjs';

function fakeWindow() {
  const listeners = new Map();
  return {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); },
    fire: type => listeners.get(type)?.(),
    size: () => listeners.size,
  };
}

test('a settled job wakes the swap poll before its back-off ends', async () => {
  const w = fakeWindow(); globalThis.window = w;
  try {
    const controller = new AbortController();
    const started = Date.now();
    const waiting = waitForPoll(20000, controller.signal);
    w.fire('veyrnox:jobs-changed');
    await waiting;
    assert.ok(Date.now() - started < 1000, 'resolved at once, not after 20 s');
    assert.equal(w.size(), 0, 'its listener is removed');
  } finally { delete globalThis.window; }
});

test('the poll still waits its time without an event and still aborts cleanly', async () => {
  const w = fakeWindow(); globalThis.window = w;
  try {
    const t0 = Date.now();
    await waitForPoll(40, new AbortController().signal);
    assert.ok(Date.now() - t0 >= 30);
    const controller = new AbortController();
    const pending = waitForPoll(20000, controller.signal);
    controller.abort();
    await assert.rejects(pending);
    assert.equal(w.size(), 0, 'abort removes the listener');
  } finally { delete globalThis.window; }
});

test('without a window (server or tests) the poll is a plain timer', async () => {
  delete globalThis.window;
  await waitForPoll(20, new AbortController().signal);
});
