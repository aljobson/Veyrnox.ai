import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_QUEUE_KEY, LEGACY_MUSIC_QUEUE_KEY, canPersistAudioQueue, cleanAudioQueueEntry, permittedAudioQueue, privateOwnedAssetPath,
  publicAudioQueueEntry, readAudioQueue, sanitizeAudioQueue, withoutOwnedAudio, writeAudioQueue,
} from '../app/veyrnox/_lib/audioQueueStorage.mjs';

class MemoryStorage {
  constructor(initial = {}) { this.data = new Map(Object.entries(initial)); this.failWrites = false; }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { if (this.failWrites) throw new Error('full'); this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

const publicRow = { type: 'public_slug', slug: 'a'.repeat(24), title: 'Public title', display_name: 'Creator' };
const ownedRow = { type: 'owned_asset', job_id: '12345678-1234-1234-1234-1234567890ab', title: 'Private audio', source: 'speech' };

test('queue schema is exact, bounded, deduplicated and never accepts durable URLs', () => {
  assert.deepEqual(cleanAudioQueueEntry(publicRow), publicRow);
  assert.equal(cleanAudioQueueEntry({ ...publicRow, url: 'https://signed.example/x' }), null);
  assert.equal(cleanAudioQueueEntry({ ...ownedRow, signed_url: 'https://signed.example/x' }), null);
  assert.equal(cleanAudioQueueEntry({ ...ownedRow, source: 'other' }), null);
  assert.equal(cleanAudioQueueEntry({ ...ownedRow, job_id: 'not-a-uuid' }), null);
  const queue = Array.from({ length: 60 }, (_, index) => ({ ...publicRow, slug: index.toString(16).padStart(24, '0') }));
  const sanitized = sanitizeAudioQueue({ version: 2, owner: '', queue: [queue[0], queue[0], ...queue], index: 999 }, '');
  assert.equal(sanitized.queue.length, 50);
  assert.equal(new Set(sanitized.queue.map(row => row.slug)).size, 50);
  assert.equal(sanitized.index, 0);
  assert.doesNotMatch(JSON.stringify(sanitized), /https?:\/\//);
});

test('rail rows are narrowed to the exact public queue schema before storage', () => {
  assert.deepEqual(publicAudioQueueEntry({ ...publicRow, handle: 'creator-handle' }), publicRow);
  assert.equal(publicAudioQueueEntry({ ...publicRow, slug: 'bad', handle: 'creator-handle' }), null);
});

test('owned ids map to the authenticated private job route', () => {
  const cleaned = cleanAudioQueueEntry(ownedRow);
  assert.equal(privateOwnedAssetPath(cleaned), '/api/v1/jobs/12345678-1234-1234-1234-1234567890ab/asset');
  assert.equal(privateOwnedAssetPath(publicRow), null);
});

test('v1 migration promotes only valid public rows and removes legacy after v2 writes', () => {
  const local = new MemoryStorage();
  const session = new MemoryStorage({ [LEGACY_MUSIC_QUEUE_KEY]: JSON.stringify({ queue: [
    { slug: publicRow.slug, title: publicRow.title, display_name: publicRow.display_name },
    { slug: 'bad', title: 'bad', job_id: ownedRow.job_id },
  ], index: 0 }) });
  const result = readAudioQueue(local, session, 'account-a');
  assert.deepEqual(result.queue, [publicRow]);
  assert.equal(session.getItem(LEGACY_MUSIC_QUEUE_KEY), null);
  assert.equal(JSON.parse(local.getItem(AUDIO_QUEUE_KEY)).version, 2);
});

test('failed migration writes preserve v1 for a later retry', () => {
  const local = new MemoryStorage(); local.failWrites = true;
  const session = new MemoryStorage({ [LEGACY_MUSIC_QUEUE_KEY]: JSON.stringify({ queue: [{ slug: publicRow.slug, title: 'T' }] }) });
  readAudioQueue(local, session, 'account-a');
  assert.notEqual(session.getItem(LEGACY_MUSIC_QUEUE_KEY), null);
});

test('account mismatch and sign-out purge owned rows before another owner can read them', () => {
  const local = new MemoryStorage({ [AUDIO_QUEUE_KEY]: JSON.stringify({ version: 2, owner: 'account-a', queue: [publicRow, ownedRow], index: 1 }) });
  const accountB = readAudioQueue(local, new MemoryStorage(), 'account-b');
  assert.deepEqual(accountB.queue, [publicRow]);
  assert.equal(accountB.owner, '');
  assert.deepEqual(withoutOwnedAudio({ queue: [ownedRow, publicRow], index: 0 }).queue, [publicRow]);
});

test('writes carry the live owner and explicit feature-off can persist a public-only envelope', () => {
  const local = new MemoryStorage();
  assert.equal(writeAudioQueue(local, 'account-a', { version: 2, owner: 'account-a', queue: [publicRow, ownedRow], index: 1 }), true);
  const saved = JSON.parse(local.getItem(AUDIO_QUEUE_KEY));
  assert.equal(saved.owner, 'account-a');
  assert.equal(saved.queue.length, 2);
  assert.equal(writeAudioQueue(local, '', withoutOwnedAudio(saved)), true);
  assert.deepEqual(JSON.parse(local.getItem(AUDIO_QUEUE_KEY)).queue, [publicRow]);
});

test('a stale account writer cannot re-owner private rows', () => {
  const local = new MemoryStorage();
  assert.equal(writeAudioQueue(local, 'account-b', { version: 2, owner: 'account-a', queue: [ownedRow], index: 0 }), false);
  assert.equal(local.getItem(AUDIO_QUEUE_KEY), null);
});

test('public and owned flags are independent in all four combinations', () => {
  const value = { version: 2, owner: 'account-a', queue: [publicRow, ownedRow], index: 1 };
  assert.deepEqual(permittedAudioQueue(value, { publicEnabled: false, ownedEnabled: false, owner: 'account-a' }).queue, []);
  assert.deepEqual(permittedAudioQueue(value, { publicEnabled: true, ownedEnabled: false, owner: 'account-a' }).queue, [publicRow]);
  assert.deepEqual(permittedAudioQueue(value, { publicEnabled: false, ownedEnabled: true, owner: 'account-a' }).queue, [ownedRow]);
  assert.deepEqual(permittedAudioQueue(value, { publicEnabled: true, ownedEnabled: true, owner: 'account-a' }).queue, [publicRow, ownedRow]);
  assert.deepEqual(permittedAudioQueue(value, { publicEnabled: true, ownedEnabled: true, owner: 'account-b' }).queue, [publicRow]);
});

test('provider persistence cannot run before the current account load completes', () => {
  assert.equal(canPersistAudioQueue(false, true, true), false);
  assert.equal(canPersistAudioQueue(true, false, false), false);
  assert.equal(canPersistAudioQueue(true, true, false), true);
  assert.equal(canPersistAudioQueue(true, false, true), true);
});
