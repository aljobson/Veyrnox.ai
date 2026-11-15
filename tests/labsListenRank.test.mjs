import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseLabsRankAction, publicPair } from '../app/veyrnox/_lib/music/labsRank.mjs';
import { musicRankingEnabled } from '../lib/musicBackend.js';

const ID = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';
const SLUG = 'a1b2c3d4e5f60718293a4b5c';

test('only a vote or an opt-in, with exact fields', () => {
  assert.deepEqual(parseLabsRankAction({ action: 'vote', pair_id: ID, winner: 'b' }), { ok: true, action: 'vote', pairId: ID, winner: 'b' });
  assert.equal(parseLabsRankAction({ action: 'vote', pair_id: ID, winner: 'c' }).error, 'vote_invalid');
  assert.equal(parseLabsRankAction({ action: 'vote', pair_id: ID, winner: 'a', credits: 5 }).error, 'vote_invalid');
  assert.equal(parseLabsRankAction({ action: 'opt_in', song_id: ID, allow: 'yes' }).error, 'opt_in_invalid');
  assert.equal(parseLabsRankAction({ action: 'grant' }).error, 'action_invalid');
});

test('a pair exposes only slugs, titles and the public audio route', () => {
  const pair = publicPair({ id: ID, a: { slug: SLUG, title: 'A', user_id: 'x' }, b: { slug: SLUG.replace('a1', 'b2'), title: 'B' } });
  assert.deepEqual(Object.keys(pair.a).sort(), ['audio_url', 'slug', 'title']);
  assert.equal(pair.a.audio_url, `/api/music/public/${SLUG}/asset`);
  assert.equal(publicPair({ id: ID, a: { slug: 'bad' }, b: { slug: SLUG } }), null);
});

test('ranking ships false, needs Labs and publication, and never touches credits', async () => {
  const on = { MUSIC_RUNTIME_FLAGS: JSON.stringify({ ui: true, schema: true, library: true, distribution: true, publication: true, labs: true, ranking: true }) };
  assert.equal(musicRankingEnabled(on), true);
  assert.equal(musicRankingEnabled({ ...on, MUSIC_LABS_ENABLED: 'false' }), false);
  const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.equal((wrangler.match(/\\"ranking\\":false/g) || []).length, 2);
  const sql = await readFile(new URL('../packages/db/schema/supabase/0538_labs_listen_and_rank.sql', import.meta.url), 'utf8');
  assert.match(sql, /allow_ranking BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sql, /interval '10 seconds'/);
  assert.match(sql, />= 200 THEN/);
  assert.match(sql, /user_id <> v_user/);
  assert.match(sql, /public\.user_blocks b WHERE b\.blocker_id = v_user/);
  assert.doesNotMatch(sql, /ledger_|credit_balances/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[^;]*TO (authenticated|anon)/);
});
