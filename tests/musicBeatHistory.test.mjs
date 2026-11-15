import test from 'node:test';
import assert from 'node:assert/strict';
import { make, freeze } from './musicBeatFixtures.mjs';
import * as h from '../app/veyrnox/_lib/music/beat/beatHistory.mjs';
import { rename, selectPattern, setSwing, clearPattern } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';

test('history caps at 200, has unique ids, clears redo after edits and round trips', () => {
  let history = h.createHistory(make());
  for (let i = 0; i < 205; i++) history = h.record(freeze(history), rename(history.present, `Beat ${i}`, 0), { label: 'rename', now: i });
  assert.equal(history.past.length, 200); assert.equal(new Set(history.past.map((e) => e.id)).size, 200);
  const original = history.present;
  history = h.undo(history); assert.equal(h.canRedo(history), true);
  assert.deepEqual(h.redo(history).present, original);
  history = h.record(history, setSwing(history.present, 0.3, 0));
  assert.equal(h.canRedo(history), false);
  for (let i = 0; i < 201; i++) history = h.undo(history);
  assert.equal(h.canUndo(history), false); assert.equal(history.present.title, 'Beat 4');
});
test('same nonempty key within 1000ms coalesces; different keys, gaps and rollback separate', () => {
  const doc = make(); let history = h.createHistory(doc);
  history = h.record(history, rename(doc, 'a', 0), { key: 'title', now: 100, label: 'rename beat' });
  const id = history.past.at(-1).id;
  history = h.record(history, rename(doc, 'b', 0), { key: 'title', now: 1100 });
  assert.equal(history.past.length, 1); assert.equal(history.past[0].id, id);
  assert.deepEqual(h.undo(history).present, doc);
  for (const [key, now] of [['title', 2101], ['gain', 2102], ['', 2103], ['', 2104], ['title', 2105], ['title', 1]]) {
    history = h.record(history, rename(doc, `${now}`, 0), { key, now });
  }
  assert.equal(history.past.length, 7);
});
test('selection replaces present after any gap; preserves redo and current pattern through travel', () => {
  let history = h.createHistory(make());
  history = h.record(history, setSwing(history.present, 0.5, 0), { now: 0, label: 'swing' });
  history = h.replacePresent(history, selectPattern(history.present, 'B', 2000));
  assert.equal(history.past.length, 1);
  history = h.undo(history);
  assert.equal(history.present.currentPattern, 'B'); assert.equal(history.present.swing, 0);
  const future = history.future;
  history = h.replacePresent(history, selectPattern(history.present, 'C', 4000));
  assert.equal(history.future, future); assert.equal(history.past.length, 0);
  history = h.redo(history);
  assert.equal(history.present.currentPattern, 'C'); assert.equal(history.present.swing, 0.5);
});
test('clear toast identity follows the actual undo entry and labels survive travel', () => {
  let history = h.createHistory(make());
  history = h.record(history, clearPattern(history.present, 0), { label: 'clear pattern' });
  const clearId = history.past.at(-1).id;
  history = h.record(history, setSwing(history.present, 0.2, 0), { label: 'change swing' });
  assert.notEqual(history.past.at(-1).id, clearId);
  history = h.undo(history); assert.equal(history.future.at(-1).label, 'change swing');
  assert.equal(history.past.at(-1).id, clearId);
  history = h.undo(history); assert.equal(history.future.at(-1).label, 'clear pattern');
  assert.equal(history.past.length, 0);
  history = h.redo(history); assert.equal(history.past.at(-1).label, 'clear pattern');
});
