import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MUSIC_PAIR_COST,
  MUSIC_QUOTE_ID,
  advanceMusicState,
  cancelMusicCandidate,
  createMusicRequest,
  findMusicSong,
  musicRows,
  newMusicPreviewState,
  parseMusicPreviewState,
  quoteMusicRequest,
} from '../app/veyrnox/_lib/music/previewStore.js';

function request(state = newMusicPreviewState(), overrides = {}) {
  return createMusicRequest(state, {
    prompt: 'Slow instrumental harbour lights with brushed drums',
    styles: 'ambient jazz, 84 bpm',
    title: 'Harbour Frame',
    mode: 'simple',
    quoteId: MUSIC_QUOTE_ID,
    idempotencyKey: 'request-1',
    requestId: 'harbour',
    ...overrides,
  }, 1000);
}

test('a filled prompt receives an exact two-candidate quote', () => {
  const state = newMusicPreviewState();
  assert.equal(quoteMusicRequest({ prompt: '' }, state), null);
  const quote = quoteMusicRequest({ prompt: 'night drive' }, state);
  assert.deepEqual(quote, {
    id: MUSIC_QUOTE_ID,
    candidates: 2,
    perCandidate: 5,
    total: 10,
    balance: 50,
    balanceAfter: 40,
    affordable: true,
  });
});

test('one idempotent request debits once and creates exactly two candidates', () => {
  const first = request();
  assert.equal(first.state.credits, 50 - MUSIC_PAIR_COST);
  assert.equal(first.request.candidates.length, 2);
  assert.deepEqual(first.request.candidates.map((candidate) => candidate.label), ['A', 'B']);
  assert.equal(first.state.ledger.filter((entry) => entry.amount === -10).length, 1);

  const replay = request(first.state);
  assert.equal(replay.replayed, true);
  assert.equal(replay.state, first.state);
  assert.equal(replay.state.credits, 40);
});

test('candidates progress independently and both become durable Library rows', () => {
  const created = request().state;
  const midway = advanceMusicState(created, 3600);
  assert.equal(midway.requests[0].candidates[0].status, 'ready');
  assert.equal(midway.requests[0].candidates[1].status, 'mastering');
  const done = advanceMusicState(midway, 5000);
  assert.deepEqual(done.requests[0].candidates.map((candidate) => candidate.status), ['ready', 'ready']);
  assert.equal(musicRows(done).length, 2);
  assert.equal(findMusicSong(done, 'harbour-a').title, 'Harbour Frame');
});

test('a failed candidate refunds only its own five-credit charge', () => {
  const created = request(newMusicPreviewState(), { scenario: 'fail-b' }).state;
  const done = advanceMusicState(created, 5000);
  assert.deepEqual(done.requests[0].candidates.map((candidate) => candidate.status), ['ready', 'failed']);
  assert.equal(done.credits, 45);
  assert.equal(done.ledger.filter((entry) => entry.reason === 'Version B failed').length, 1);
  const repeated = advanceMusicState(done, 9000);
  assert.equal(repeated.credits, 45);
});

test('cancelling one in-flight candidate preserves the other and refunds once', () => {
  const created = request().state;
  const cancelled = cancelMusicCandidate(created, 'harbour-a');
  assert.equal(cancelled.credits, 45);
  assert.equal(cancelled.requests[0].candidates[0].status, 'cancelled');
  assert.equal(cancelled.requests[0].candidates[1].status, 'queued');
  assert.equal(cancelMusicCandidate(cancelled, 'harbour-a'), cancelled);
});

test('malformed saved state is rejected instead of being trusted', () => {
  assert.throws(() => parseMusicPreviewState('{broken'));
  assert.throws(() => parseMusicPreviewState(JSON.stringify({ version: 1, credits: '50', requests: [], ledger: [] })));
});
