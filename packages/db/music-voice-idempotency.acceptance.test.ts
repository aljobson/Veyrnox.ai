import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;

describe('music voice failed-challenge idempotency', { skip: !DATABASE_URL && 'DATABASE_URL not set', concurrency: false }, () => {
  let client: pg.Client;

  const one = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows[0];

  before(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    await client.query('BEGIN');
  });

  after(async () => {
    if (client) {
      try { await client.query('ROLLBACK'); } finally { await client.end(); }
    }
  });

  it('replaying one wrong-phrase request consumes exactly one attempt and writes one failure event', async () => {
    const authId = `voice_${randomUUID()}`;
    const email = `${randomUUID()}@test.veyrnox.ai`;
    const userId = (await one('SELECT public.signup_grant($1,$2) AS id', [authId, email])).id;
    const profileId = randomUUID();
    const idempotencyKey = `voice-submit-${randomUUID()}`;
    const digest = 'a'.repeat(64);

    await client.query(`INSERT INTO public.music_voice_profiles
      (id,user_id,name,status,challenge_nonce,challenge_hmac,challenge_ciphertext,challenge_issued_at,
       challenge_expires_at,consent_version,policy_version)
      VALUES($1,$2,'Replay proof','challenge_issued',$3,$4,$5,clock_timestamp(),
       clock_timestamp()+interval '20 minutes','music-own-voice-2026-11-24','music-voice-review-v1')`,
    [profileId, userId, 'n'.repeat(24), 'h'.repeat(64), 'c'.repeat(64)]);

    const call = () => one(`SELECT public.music_voice_submit(
      $1,$2::uuid,'unused','audio/wav',100,2,'wrong-proof',$3,$4,'aal2',clock_timestamp()) AS result`,
    [authId, profileId, idempotencyKey, digest]);

    const first = (await call()).result;
    const replay = (await call()).result;
    assert.deepEqual(first, { profile_id: profileId, ok: false, code: 'CHALLENGE_MISMATCH', attempts_remaining: 2, idempotent: false });
    assert.deepEqual(replay, { profile_id: profileId, ok: false, code: 'CHALLENGE_MISMATCH', attempts_remaining: 2, idempotent: true });

    const state = await one(`SELECT challenge_attempt_count,
      (SELECT count(*)::int FROM public.music_voice_events
       WHERE profile_id=$1 AND event_type='challenge_failed') AS failed_events,
      (SELECT count(*)::int FROM public.music_voice_receipts
       WHERE actor_user_id=$2 AND operation='submit' AND idempotency_key=$3) AS receipts
      FROM public.music_voice_profiles WHERE id=$1`, [profileId, userId, idempotencyKey]);
    assert.deepEqual(state, { challenge_attempt_count: 1, failed_events: 1, receipts: 1 });
  });
});
