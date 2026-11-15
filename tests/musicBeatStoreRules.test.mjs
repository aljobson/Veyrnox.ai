import test from 'node:test';
import assert from 'node:assert/strict';
import { createBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { decideCreate, decideUpdate, decideDelete, validRecord } from '../app/veyrnox/_lib/music/beat/beatStoreRules.mjs';
const doc = createBeat({ id: 'e40439d1-646a-4c11-9c12-69fa3a851234', now: 0 });
const existing = { id: doc.id, revision: 4, doc, updatedAt: 0 };
test('matching revision updates once; a stale revision conflicts', () => {
  const next = { ...doc, title: 'Renamed', updatedAt: 10 };
  const result = decideUpdate(existing, next, 4);
  assert.equal(result.action, 'put'); assert.equal(result.record.revision, 5); assert.equal(result.record.updatedAt, 10);
  assert.equal(decideUpdate(result.record, doc, 4).error, 'conflict');
  assert.equal(existing.doc.title, 'Untitled beat 1');
});
test('deleted records cannot be resurrected by stale updates', () => {
  assert.equal(decideDelete(existing, 4).action, 'delete');
  assert.equal(decideUpdate(undefined, doc, 4).error, 'not_found');
  assert.equal(decideDelete(undefined).error, 'not_found');
});
test('invalid documents and damaged records never update', () => {
  assert.equal(decideUpdate(existing, { ...doc, extra: 1 }, 4).error, 'invalid');
  assert.equal(decideUpdate({ ...existing, revision: 0 }, doc, 0).error, 'invalid');
  assert.equal(validRecord({ ...existing, updatedAt: 5 }), false);
});
test('create refuses duplicates and conditional delete protects a newer revision', () => {
  assert.equal(decideCreate(existing).error, 'conflict');
  assert.equal(decideCreate(undefined).action, 'put');
  assert.equal(decideDelete(existing, 3).error, 'conflict');
  assert.equal(decideDelete(existing).action, 'delete');
});
