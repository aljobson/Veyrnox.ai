import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  MUSIC_PARITY_AREA_WEIGHTS,
  MUSIC_PARITY_FLAG_EXEMPTIONS,
  MUSIC_PARITY_FLAG_ROWS,
  MUSIC_PARITY_PRODUCTION_SNAPSHOT,
  MUSIC_PARITY_ROWS,
  calculateMusicParity,
  validateMusicParityInventory,
} from '../lib/musicParityInventory.js';
import { MUSIC_RUNTIME_FLAG_NAMES, musicRuntimeFlag } from '../lib/musicRuntime.js';
import { parseJsonc } from '../scripts/check-migration-ledger.mjs';

test('the immutable baseline, dated current score, target and pre-activation ceiling recompute from rows', () => {
  const baseline = calculateMusicParity('baseline');
  const current = calculateMusicParity('current');
  const target = calculateMusicParity('target');
  const preactivation = calculateMusicParity('preactivation');
  assert.deepEqual(baseline.areas, { creation: 70, editing: 72.5, daw: 62.5, library: 75, community: 60, ios: 52.5 });
  assert.equal(baseline.total, 67);
  assert.deepEqual(current.areas, { creation: 72.5, editing: 72.5, daw: 67.5, library: 82.5, community: 72.5, ios: 52.5 });
  assert.equal(current.total, 71);
  assert.deepEqual(target.areas, { creation: 80, editing: 85, daw: 97.5, library: 100, community: 100, ios: 93 });
  assert.equal(target.total, 90.8);
  assert.equal(preactivation.total, 85.925);
  assert.equal(Object.values(MUSIC_PARITY_AREA_WEIGHTS).reduce((sum, weight) => sum + weight, 0), 100);
});

test('Music MCP current credit does not rewrite its missing baseline', () => {
  const row = MUSIC_PARITY_ROWS.find((item) => item.id === 'community.music-mcp');
  assert.equal(row?.baseline, 'missing');
  assert.equal(row?.current, 'shipped');
  assert.equal(row?.proof, 'mcp_music_contract');
});

test('row weights, evidence paths, statuses and static runtime flag coverage cannot drift', () => {
  assert.deepEqual(validateMusicParityInventory(), []);
  assert.equal(new Set(MUSIC_PARITY_ROWS.map((item) => item.id)).size, MUSIC_PARITY_ROWS.length);
  const covered = new Set([...Object.keys(MUSIC_PARITY_FLAG_ROWS), ...MUSIC_PARITY_FLAG_EXEMPTIONS]);
  assert.deepEqual(new Set(MUSIC_RUNTIME_FLAG_NAMES), covered);
  for (const item of MUSIC_PARITY_ROWS) {
    assert.ok(item.route);
    for (const path of [...item.evidence, ...item.outcomeEvidence]) assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, `${item.id}:${path}`);
  }
});

test('the dated production capability snapshot matches committed production configuration', () => {
  const config = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const configured = JSON.parse(config.vars.MUSIC_RUNTIME_FLAGS);
  const observed = Object.fromEntries(MUSIC_RUNTIME_FLAG_NAMES.map((name) => [name, configured[name] === true || configured[name] === 'true']));
  assert.deepEqual(MUSIC_PARITY_PRODUCTION_SNAPSHOT.flags, observed);
  assert.equal(MUSIC_PARITY_PRODUCTION_SNAPSHOT.gates.PERSONAS_ENABLED, config.vars.PERSONAS_ENABLED === 'true');
  assert.equal(MUSIC_PARITY_PRODUCTION_SNAPSHOT.observedAt, '2026-11-24');
  assert.deepEqual(MUSIC_PARITY_FLAG_ROWS.longSongs, { disposition: 'dark', rows: ['edit.sections-extend-crop'] });
  assert.deepEqual(MUSIC_PARITY_FLAG_ROWS.dailyCredits, { disposition: 'dark', rows: ['create.quote-rights-recovery'] });
  assert.deepEqual(MUSIC_PARITY_FLAG_ROWS.voices, { disposition: 'dark', rows: [] });
});

test('new parity capabilities are recognized but remain default off', () => {
  for (const flag of ['albums', 'inspiration', 'studioChat', 'dailyChallenge', 'persistentQueue', 'nativeSources', 'voices']) {
    assert.equal(musicRuntimeFlag(flag, {}), false);
    assert.equal(musicRuntimeFlag(flag, { MUSIC_RUNTIME_FLAGS: JSON.stringify({ [flag]: true }) }), true);
  }
  assert.equal(musicRuntimeFlag('notARealMusicCapability', { MUSIC_RUNTIME_FLAGS: '{"notARealMusicCapability":true}' }), false);
});

test('albums earn source qualification only and remain outside the shipped score while rollout is off', () => {
  for (const id of ['library.albums-releases', 'community.public-albums', 'community.album-profile-shelves']) {
    const row = MUSIC_PARITY_ROWS.find((item) => item.id === id);
    assert.equal(row?.baseline, 'missing');
    assert.equal(row?.current, 'qualified');
    assert.equal(row?.target, 'shipped');
    assert.match(row?.proof ?? '', /ios/);
  }
  assert.equal(MUSIC_PARITY_PRODUCTION_SNAPSHOT.flags.albums, false);
  assert.equal(musicRuntimeFlag('albums', {}), false);
});

test('iOS-only scope withholds personalization credit until native outcome evidence exists', () => {
  const row = MUSIC_PARITY_ROWS.find((item) => item.id === 'create.models-personalization');
  assert.equal(row?.baseline, 'missing');
  assert.equal(row?.current, 'missing');
  assert.equal(row?.target, 'intentionally_different');
  assert.deepEqual(row?.outcomeEvidence, []);
  assert.deepEqual(row?.requiredGates, ['PERSONAS_ENABLED']);
  assert.deepEqual(MUSIC_PARITY_FLAG_ROWS.voices, { disposition: 'dark', rows: [] });
});

test('candidate cancellation evidence stays partial until live route and iPhone proof exist', () => {
  const row = MUSIC_PARITY_ROWS.find((item) => item.id === 'create.production-route-health');
  assert.equal(row.current, 'qualified');
  assert.match(row.proof, /candidate_cancel_contract_ios_ui/);
});

test('daily challenge credits only the qualified creation outcome until live iPhone proof and participation exist', () => {
  assert.equal(MUSIC_PARITY_ROWS.find((item) => item.id === 'create.daily-challenge')?.current, 'qualified');
  assert.equal(MUSIC_PARITY_ROWS.find((item) => item.id === 'community.daily-challenge-participation')?.current, 'missing');
  assert.equal(MUSIC_PARITY_ROWS.find((item) => item.id === 'community.challenge-discovery-shelf')?.current, 'missing');
});

test('persistent queue earns only qualification until default-off rollout and iPhone proof exist', () => {
  const row = MUSIC_PARITY_ROWS.find((item) => item.id === 'library.account-fenced-audio-queue');
  assert.equal(row?.baseline, 'missing');
  assert.equal(row?.current, 'qualified');
  assert.equal(row?.target, 'shipped');
  assert.equal(row?.proof, 'storage_account_ios_ui_device');
  assert.equal(musicRuntimeFlag('persistentQueue', {}), false);
});

test('native owned sources stay qualified behind their separate default-off phone gate', () => {
  const row = MUSIC_PARITY_ROWS.find((item) => item.id === 'ios.song-actions-library');
  assert.equal(row?.current, 'qualified');
  assert.equal(row?.target, 'shipped');
  assert.deepEqual(MUSIC_PARITY_FLAG_ROWS.nativeSources.rows, ['ios.song-actions-library']);
  assert.equal(musicRuntimeFlag('nativeSources', {}), false);
  assert.equal(MUSIC_PARITY_PRODUCTION_SNAPSHOT.flags.nativeSources, false);
});

test('Studio actions earn qualification without claiming rollout, iPhone proof, generation or plugins', () => {
  const local = MUSIC_PARITY_ROWS.find((item) => item.id === 'daw.conversational-local-actions');
  const generative = MUSIC_PARITY_ROWS.find((item) => item.id === 'daw.generative-chat-and-plugins');
  assert.equal(local?.baseline, 'missing');
  assert.equal(local?.current, 'qualified');
  assert.equal(local?.target, 'shipped');
  assert.match(local?.proof ?? '', /ios_simulator/);
  assert.equal(generative?.baseline, 'missing');
  assert.equal(generative?.current, 'qualified');
  assert.equal(generative?.target, 'qualified');
  assert.match(generative?.proof ?? '', /no_plugin_execution/);
  assert.equal(musicRuntimeFlag('studioChat', {}), false);
});
