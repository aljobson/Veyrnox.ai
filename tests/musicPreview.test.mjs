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

test('a filled prompt receives an exact single-track quote', () => {
  const state = newMusicPreviewState();
  assert.equal(quoteMusicRequest({ prompt: '' }, state), null);
  const quote = quoteMusicRequest({ prompt: 'night drive' }, state);
  assert.deepEqual(quote, {
    id: MUSIC_QUOTE_ID,
    candidates: 1,
    perCandidate: 5,
    total: 5,
    balance: 50,
    balanceAfter: 45,
    affordable: true,
  });
});

test('one idempotent request debits once and creates exactly one track', () => {
  const first = request();
  assert.equal(first.state.credits, 50 - MUSIC_PAIR_COST);
  assert.equal(first.request.candidates.length, 1);
  assert.deepEqual(first.request.candidates.map((candidate) => candidate.label), ['Track']);
  assert.equal(first.state.ledger.filter((entry) => entry.amount === -5).length, 1);

  const replay = request(first.state);
  assert.equal(replay.replayed, true);
  assert.equal(replay.state, first.state);
  assert.equal(replay.state.credits, 45);
});

test('the generated track becomes one durable Library row', () => {
  const created = request().state;
  const done = advanceMusicState(created, 5000);
  assert.deepEqual(done.requests[0].candidates.map((candidate) => candidate.status), ['ready']);
  assert.equal(musicRows(done).length, 1);
  assert.equal(findMusicSong(done, 'harbour-track').title, 'Harbour Frame');
});

test('a failed track refunds its five-credit charge once', () => {
  const created = request(newMusicPreviewState(), { scenario: 'fail-b' }).state;
  const done = advanceMusicState(created, 5000);
  assert.deepEqual(done.requests[0].candidates.map((candidate) => candidate.status), ['failed']);
  assert.equal(done.credits, 50);
  assert.equal(done.ledger.filter((entry) => entry.reason === 'Track failed').length, 1);
  const repeated = advanceMusicState(done, 9000);
  assert.equal(repeated.credits, 50);
});

test('cancelling the in-flight track refunds once', () => {
  const created = request().state;
  const cancelled = cancelMusicCandidate(created, 'harbour-track');
  assert.equal(cancelled.credits, 50);
  assert.equal(cancelled.requests[0].candidates[0].status, 'cancelled');
  assert.equal(cancelMusicCandidate(cancelled, 'harbour-track'), cancelled);
});

test('malformed saved state is rejected instead of being trusted', () => {
  assert.throws(() => parseMusicPreviewState('{broken'));
  assert.throws(() => parseMusicPreviewState(JSON.stringify({ version: 1, credits: '50', requests: [], ledger: [] })));
});
