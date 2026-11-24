import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MUSIC_PARITY_AREA_WEIGHTS,
  MUSIC_PARITY_FLAG_EXEMPTIONS,
  MUSIC_PARITY_FLAG_ROWS,
  MUSIC_PARITY_ROWS,
  calculateMusicParity,
  validateMusicParityInventory,
} from '../lib/musicParityInventory.js';
import { MUSIC_RUNTIME_FLAG_NAMES, musicRuntimeFlag } from '../lib/musicRuntime.js';

test('the frozen Music parity inventory recomputes the evidence-qualified current score and target', () => {
  const current = calculateMusicParity('current');
  const target = calculateMusicParity('target');
  assert.deepEqual(current.areas, { creation: 82.5, editing: 72.5, daw: 67.5, library: 75, community: 65, ios: 52.5 });
  assert.deepEqual(target.areas, { creation: 90, editing: 85, daw: 97.5, library: 100, community: 100, ios: 93 });
  assert.equal(current.total, 71.625);
  assert.equal(target.total, 93.3);
  assert.equal(Object.values(MUSIC_PARITY_AREA_WEIGHTS).reduce((sum, weight) => sum + weight, 0), 100);
});

test('Music MCP is credited only after its quote, approval, status, signed-asset and playlist contract ships', () => {
  const row = MUSIC_PARITY_ROWS.find(item => item.id === 'community.music-mcp');
  assert.equal(row?.current, 'shipped');
  assert.equal(row?.proof, 'mcp_music_contract');
});

test('row weights, statuses and static runtime flag coverage cannot drift', () => {
  assert.deepEqual(validateMusicParityInventory(), []);
  assert.equal(new Set(MUSIC_PARITY_ROWS.map((item) => item.id)).size, MUSIC_PARITY_ROWS.length);
  const covered = new Set([...Object.keys(MUSIC_PARITY_FLAG_ROWS), ...MUSIC_PARITY_FLAG_EXEMPTIONS]);
  assert.deepEqual(new Set(MUSIC_RUNTIME_FLAG_NAMES), covered);
});

test('new parity capabilities are recognized but remain default off', () => {
  for (const flag of ['albums', 'inspiration', 'studioChat', 'dailyChallenge', 'persistentQueue']) {
    assert.equal(musicRuntimeFlag(flag, {}), false);
    assert.equal(musicRuntimeFlag(flag, { MUSIC_RUNTIME_FLAGS: JSON.stringify({ [flag]: true }) }), true);
  }
  assert.equal(musicRuntimeFlag('notARealMusicCapability', { MUSIC_RUNTIME_FLAGS: '{"notARealMusicCapability":true}' }), false);
});

test('candidate cancellation evidence stays partial until live route and device proof exist', () => {
  const row = MUSIC_PARITY_ROWS.find(item => item.id === 'create.production-route-health');
  assert.equal(row.current, 'qualified');
  assert.match(row.proof, /candidate_cancel_contract_ui/);
});

test('daily challenge credits only the qualified creation outcome until live UI proof and participation exist', () => {
  assert.equal(MUSIC_PARITY_ROWS.find(item => item.id === 'create.daily-challenge')?.current, 'qualified');
  assert.equal(MUSIC_PARITY_ROWS.find(item => item.id === 'community.daily-challenge-participation')?.current, 'missing');
  assert.equal(MUSIC_PARITY_ROWS.find(item => item.id === 'community.challenge-discovery-shelf')?.current, 'missing');
});

test('Studio actions earn qualification without claiming rollout, Reticle, simulator, generation or plugins', () => {
  const local = MUSIC_PARITY_ROWS.find(item => item.id === 'daw.conversational-local-actions');
  const generative = MUSIC_PARITY_ROWS.find(item => item.id === 'daw.generative-chat-and-plugins');
  assert.equal(local?.current, 'qualified');
  assert.equal(local?.target, 'shipped');
  assert.match(local?.proof ?? '', /reticle_simulator/);
  assert.equal(generative?.current, 'qualified');
  assert.equal(generative?.target, 'qualified');
  assert.match(generative?.proof ?? '', /no_plugin_execution/);
  assert.equal(musicRuntimeFlag('studioChat', {}), false);
});
