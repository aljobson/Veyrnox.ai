import assert from 'node:assert/strict';
import test from 'node:test';
import { cancelSmartCutBatchItem, createSmartCutBatch, failSmartCutBatchItem, finishSmartCutBatchItem, nextSmartCutBatchItem, openSmartCutBatchItem, parseSmartCutBatch, readSmartCutBatch, retrySmartCutBatchItem, smartCutBatchDone, writeSmartCutBatch } from '../app/veyrnox/_lib/smartCutBatchQueue.mjs';

const projects = [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }, { id: 'p2', name: 'duplicate' }, { id: 'p3', name: 'Three' }];
test('batch queue is owner/workspace scoped, deduplicated and requires multiple projects', () => {
  assert.equal(createSmartCutBatch({ owner: 'u', workspaceId: 'w', projects: projects.slice(0, 1), id: 'q' }), null);
  const queue = createSmartCutBatch({ owner: 'u', workspaceId: 'w', projects, id: 'q', now: 10 });
  assert.deepEqual(queue.items.map((item) => item.projectId), ['p1', 'p2', 'p3']);
  assert.equal(parseSmartCutBatch(queue, 'other', 'w'), null);
  assert.equal(parseSmartCutBatch(queue, 'u', 'other'), null);
  assert.equal(createSmartCutBatch({ owner: 'u', workspaceId: 'w', projects: [{ id: 'blank', name: '' }, { id: 'p2', name: 'Two' }], id: 'blank-name' }).items[0].name, '');
});
test('one item is active, then completes or fails and retries without changing identity', () => {
  let queue = createSmartCutBatch({ owner: 'u', workspaceId: 'w', projects, id: 'q', now: 10 });
  queue = openSmartCutBatchItem(queue, 'p1', 11);
  const blocked = openSmartCutBatchItem(queue, 'p2', 12);
  assert.equal(nextSmartCutBatchItem(blocked).projectId, 'p1');
  queue = failSmartCutBatchItem(queue, 'p1', 'Connection interrupted', 13);
  assert.equal(queue.items[0].state, 'failed');
  queue = retrySmartCutBatchItem(queue, 'p1', 14);
  queue = openSmartCutBatchItem(queue, 'p1', 15);
  queue = finishSmartCutBatchItem(queue, 'p1', 16);
  queue = cancelSmartCutBatchItem(queue, 'p2', 17);
  queue = openSmartCutBatchItem(queue, 'p3', 18);
  queue = finishSmartCutBatchItem(queue, 'p3', 19);
  assert.equal(queue.id, 'q');
  assert.equal(smartCutBatchDone(queue), true);
});
test('storage recovery repairs extra active rows and corrupt storage fails closed', () => {
  const values = new Map(); const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const queue = createSmartCutBatch({ owner: 'u', workspaceId: 'w', projects, id: 'q', now: 10 });
  assert.equal(writeSmartCutBatch(storage, queue), true);
  assert.equal(readSmartCutBatch(storage, 'u', 'w').items.length, 3);
  storage.setItem('veyrnox:smart-cut-batch:v1:u:w', '{bad');
  assert.equal(readSmartCutBatch(storage, 'u', 'w'), null);
  const unsafe = { ...queue, items: queue.items.map((item) => ({ ...item, state: 'active' })) };
  assert.deepEqual(parseSmartCutBatch(unsafe, 'u', 'w').items.map((item) => item.state), ['active', 'pending', 'pending']);
  const duplicate = { ...queue, items: [{ ...queue.items[0], state: 'completed' }, { ...queue.items[0], state: 'failed' }, { ...queue.items[1], state: 'cancelled' }] };
  assert.deepEqual(parseSmartCutBatch(duplicate, 'u', 'w').items.map((item) => item.state), ['completed', 'cancelled']);
  assert.equal(writeSmartCutBatch(null, queue), false);
  assert.equal(writeSmartCutBatch({ setItem() { throw new Error('quota'); } }, queue), false);
});
