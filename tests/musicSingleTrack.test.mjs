import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CRUN_SUNO_LIMITS, parseCrunMusicQuote } from '../lib/musicCrunContract.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('create surfaces use direct smart controls and one-track language', async () => {
  const [web, server, advanced, controls, mobile] = await Promise.all([
    read('app/veyrnox/_components/music/MusicCreateStudio.jsx'),
    read('app/veyrnox/_components/music/MusicServerStudio.jsx'),
    read('app/veyrnox/_components/music/MusicAdvancedDirectionFields.jsx'),
    read('app/veyrnox/_components/music/MusicSunoControls.jsx'),
    read('apps/mobile/src/components/music/MusicSmartDirectionControls.tsx'),
  ]);
  for (const label of ['Voice', 'Genre', 'Mood', 'Tempo', 'Song structure']) {
    assert.match(advanced, new RegExp(label));
    assert.match(mobile, new RegExp(label));
  }
  for (const bpm of ['72 BPM', '84 BPM', '108 BPM', '128 BPM']) {
    assert.match(advanced, new RegExp(bpm));
    assert.match(mobile, new RegExp(bpm));
  }
  assert.doesNotMatch(web + server + advanced + controls, /<select\b/);
  assert.match(advanced, /boundedJoin/);
  assert.match(advanced, /max - suffixText\.length - separator\.length/);
  assert.match(web, /Turn one idea into one track/);
  assert.match(server, /Create one track/);
  assert.doesNotMatch(web + server, /two versions|2 versions|two candidates/i);
});

test('0619 freezes one debit, candidate and dispatch while preserving replay safety', async () => {
  const sql = await read('packages/db/schema/supabase/0619_music_single_track_and_suno_360.sql');
  assert.match(sql, /CHECK\(output_count IN \(1,2\)\)/);
  assert.match(sql, /NEW\.output_count:=1/);
  assert.match(sql, /NEW\.total_credits:=NEW\.unit_credits/);
  assert.match(sql, /Required second receipt lookup after the balance lock/);
  assert.match(sql, /VALUES\(v_user,q\.id,p\.id,m\.id,p_idempotency_key,q\.total_credits,1\)/);
  assert.match(sql, /VALUES\(v_user,req\.id,1,job1\)/);
  assert.match(sql, /VALUES\(job1,q\.provider_endpoint,payload\)/);
  assert.doesNotMatch(sql, /job2|\.2'/);
  assert.match(sql, /q\.output_count<>1/);
  assert.match(sql, /ready_count=expected/);
  assert.match(sql, /CASE WHEN r\.output_count=1 THEN 'Track' WHEN c\.ordinal=1 THEN 'A' ELSE 'B' END/);
  assert.match(sql, /'daily_free_candidates',q\.daily_free_candidates,'charged_credits',q\.charged_credits/);
});

test('generation responses keep one-track labels while preserving historical A/B replays', async () => {
  const route = await read('app/api/v1/music/generations/route.js');
  assert.match(route, /jobs\.length === 1 \? 'Track' : index === 0 \? 'A' : 'B'/);
  assert.match(route, /ordinal: index \+ 1/);
});

test('the verified Suno duration boundary is 1 through 360 seconds', () => {
  assert.deepEqual(CRUN_SUNO_LIMITS.duration_seconds, { min: 1, max: 360, default: 60, custom_only: true });
  const base = {
    mode: 'custom', provider_contract: 'crun-suno-v1',
    draft_id: '92ed2d0d-8276-4fbb-9c4f-39f401a3158b', draft_revision: 1,
    instrumental: true, rights_confirmed: false,
  };
  assert.equal(parseCrunMusicQuote({ ...base, duration_seconds: 360 }).ok, true);
  assert.equal(parseCrunMusicQuote({ ...base, duration_seconds: 361 }).error, 'duration_invalid');
});
