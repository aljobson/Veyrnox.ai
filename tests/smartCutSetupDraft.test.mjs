import assert from 'node:assert/strict';
import test from 'node:test';
import { readSmartCutSetupDraft, removeSmartCutSetupDraft, smartCutSetupHasWork, writeSmartCutSetupDraft } from '../app/veyrnox/_lib/smartCutSetupDraft.mjs';

const clips = [{ job_id: 'job-one', uid: 'job-one#0', in_s: 0, out_s: 9.5 }];
const setup = { script: 'Keep this line', notes: '', pacing: 'balanced', language: 'auto', removeFillers: false, skippedFillers: [] };
const memory = () => {
  const values = new Map();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};

test('Smart Cut setup drafts are account and exact-source scoped', () => {
  const storage = memory();
  writeSmartCutSetupDraft(storage, 'person-one', clips, setup, 123);
  assert.deepEqual(readSmartCutSetupDraft(storage, 'person-one', clips), { setup, updatedAt: 123 });
  assert.equal(readSmartCutSetupDraft(storage, 'person-two', clips), null);
  assert.equal(readSmartCutSetupDraft(storage, 'person-one', [{ ...clips[0], out_s: 8 }]), null);
});

test('only safe setup inputs are persisted; analysis and plans are not accepted', () => {
  const storage = memory();
  assert.equal(smartCutSetupHasWork({ ...setup, script: '' }), false);
  assert.throws(() => writeSmartCutSetupDraft(storage, 'person-one', clips, { ...setup, pacing: 'instant' }));
  writeSmartCutSetupDraft(storage, 'person-one', clips, { ...setup, analysis: { transcript: 'private' }, plan: { segments: [] } }, 456);
  const raw = JSON.parse([...storage.values.values()][0]);
  assert.deepEqual(Object.keys(raw.setup).sort(), ['language', 'notes', 'pacing', 'removeFillers', 'script', 'skippedFillers'].sort());
  removeSmartCutSetupDraft(storage, 'person-one');
  assert.equal(storage.values.size, 0);
});

test('malformed, empty and oversized drafts are discarded', () => {
  const storage = memory();
  writeSmartCutSetupDraft(storage, 'person-one', clips, setup);
  const key = [...storage.values.keys()][0];
  storage.values.set(key, JSON.stringify({ version: 1, updatedAt: 1, clipSignature: JSON.stringify([{ jobId: 'job-one', uid: 'job-one#0', start: 0, end: 9.5 }]), setup: { ...setup, script: 'x'.repeat(20_001) } }));
  assert.equal(readSmartCutSetupDraft(storage, 'person-one', clips), null);
  assert.equal(storage.values.size, 0);
});

test('blocked browser storage never breaks Smart Cut', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(readSmartCutSetupDraft(blocked, 'person-one', clips), null);
  assert.doesNotThrow(() => removeSmartCutSetupDraft(blocked, 'person-one'));
});
