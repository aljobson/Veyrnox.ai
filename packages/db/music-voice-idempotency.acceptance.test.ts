import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const POLICY = 'music-voice-review-v1';
const CONSENT = 'music-own-voice-2026-11-24';
const digest = (value: string) => value.repeat(64).slice(0, 64);

describe('music voice state-change idempotency', { skip: !DATABASE_URL && 'DATABASE_URL not set', concurrency: false }, () => {
  let client: pg.Client;
  const one = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows[0];
  const user = async (admin = false) => {
    const auth = randomUUID(), email = `${auth}@test.veyrnox.ai`;
    await client.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,clock_timestamp())', [auth, email]);
    const id = (await one('SELECT public.provision_user($1,$2) AS id', [auth, email])).id;
    if (admin) {
      await client.query('UPDATE public.users SET is_admin=true WHERE id=$1', [id]);
      await client.query("INSERT INTO public.admin_roles(user_id,role) VALUES($1,'owner') ON CONFLICT(user_id) DO UPDATE SET role='owner'", [id]);
    }
    return { auth, id };
  };
  const reserve = (owner: string, key: string, size = 100) => client.query(
    'INSERT INTO public.upload_reservations(r2_key,user_id,size_bytes) VALUES($1,$2,$3)', [key, owner, size]);
  const directProfile = async (owner: string, status: 'challenge_issued' | 'pending_review' = 'challenge_issued') => {
    const id = randomUUID(), reference = `music-voice-uploads/${randomUUID()}/${randomUUID()}.wav`;
    const challenge = status === 'pending_review' ? `music-voice-uploads/${randomUUID()}/${randomUUID()}.wav` : null;
    await client.query(`INSERT INTO public.music_voice_profiles
      (id,user_id,name,status,reference_source_key,reference_mime_type,reference_size_bytes,reference_duration_seconds,
       challenge_source_key,challenge_mime_type,challenge_size_bytes,challenge_duration_seconds,challenge_nonce,challenge_hmac,
       challenge_ciphertext,challenge_issued_at,challenge_expires_at,submission_revision,review_expires_at,consent_version,policy_version)
      VALUES($1,$2,'Replay proof',$3,$4,'audio/wav',100,2,$5,CASE WHEN $5::text IS NULL THEN NULL ELSE 'audio/wav' END,
       CASE WHEN $5::text IS NULL THEN NULL ELSE 100 END,CASE WHEN $5::text IS NULL THEN NULL ELSE 2 END,$6,$7,$8,
       clock_timestamp(),clock_timestamp()+interval '20 minutes',CASE WHEN $3='pending_review' THEN 1 ELSE 0 END,
       CASE WHEN $3='pending_review' THEN clock_timestamp()+interval '7 days' ELSE NULL END,$9,$10)`,
    [id, owner, status, reference, challenge, 'n'.repeat(24), 'h'.repeat(64), 'c'.repeat(64), CONSENT, POLICY]);
    return { id, reference, challenge };
  };

  before(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    await client.query('BEGIN');
    if (!(await one("SELECT to_regclass('public.music_voice_profiles') IS NOT NULL AS ready")).ready) {
      // The shared acceptance fixture intentionally omits the moderation-only
      // evidence table. Supply the narrow dependency inside this transaction
      // so the branch migration can be exercised without weakening production
      // migration semantics; ROLLBACK removes it with the rest of the fixture.
      if (!(await one("SELECT to_regclass('public.evidence_holds') IS NOT NULL AS ready")).ready) {
        await client.query('CREATE TABLE public.evidence_holds (r2_key TEXT, released_at TIMESTAMPTZ)');
      }
      const sql = (await readFile(new URL('./schema/supabase/0623_music_voice_verification.sql', import.meta.url), 'utf8'))
        .replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
      await client.query(sql);
    }
  });

  after(async () => {
    if (client) { try { await client.query('ROLLBACK'); } finally { await client.end(); } }
  });

  it('enrollment and challenge reissue replay without a second state transition', async () => {
    const owner = await user(), profileId = randomUUID();
    const reference = `music-voice-uploads/${owner.auth}/${randomUUID()}.wav`;
    await reserve(owner.id, reference);
    const enrollKey = `voice-enroll-${randomUUID()}`, enrollDigest = digest('a');
    const enroll = () => one(`SELECT public.music_voice_enroll($1,$2,$3,$4,'audio/wav',100,2,$5,$6,$7,$8,$9,'aal2',clock_timestamp(),$10,$11) AS result`,
      [owner.auth, profileId, 'My voice', reference, 'n'.repeat(24), 'h'.repeat(64), 'c'.repeat(64), enrollKey, enrollDigest, CONSENT, POLICY]);
    assert.equal((await enroll()).result.idempotent, false);
    assert.equal((await enroll()).result.idempotent, true);
    let counts = await one(`SELECT (SELECT count(*)::int FROM public.music_voice_events WHERE profile_id=$1 AND event_type='enrolled') events,
      (SELECT count(*)::int FROM public.music_voice_receipts WHERE actor_user_id=$2 AND operation='enroll') receipts`, [profileId, owner.id]);
    assert.deepEqual(counts, { events: 1, receipts: 1 });

    const reissueKey = `voice-reissue-${randomUUID()}`, reissueDigest = digest('b');
    const reissue = () => one(`SELECT public.music_voice_reissue($1,$2,$3,$4,$5,$6,$7,'aal2',clock_timestamp()) AS result`,
      [owner.auth, profileId, 'r'.repeat(24), 'p'.repeat(64), 'x'.repeat(64), reissueKey, reissueDigest]);
    assert.equal((await reissue()).result.idempotent, false);
    assert.equal((await reissue()).result.idempotent, true);
    counts = await one(`SELECT challenge_reissue_count,
      (SELECT count(*)::int FROM public.music_voice_events WHERE profile_id=$1 AND event_type='challenge_reissued') events,
      (SELECT count(*)::int FROM public.music_voice_receipts WHERE actor_user_id=$2 AND operation='reissue') receipts
      FROM public.music_voice_profiles WHERE id=$1`, [profileId, owner.id]);
    assert.deepEqual(counts, { challenge_reissue_count: 1, events: 1, receipts: 1 });
  });

  it('successful submission and revocation replay without duplicate events or deletion work', async () => {
    const owner = await user(), profile = await directProfile(owner.id);
    const challenge = `music-voice-uploads/${owner.auth}/${randomUUID()}.wav`;
    await reserve(owner.id, challenge);
    const submitKey = `voice-submit-${randomUUID()}`, submitDigest = digest('c');
    const submit = () => one(`SELECT public.music_voice_submit($1,$2,$3,'audio/wav',100,2,$4,$5,$6,'aal2',clock_timestamp()) AS result`,
      [owner.auth, profile.id, challenge, 'h'.repeat(64), submitKey, submitDigest]);
    assert.equal((await submit()).result.idempotent, false);
    assert.equal((await submit()).result.idempotent, true);
    let counts = await one(`SELECT status,submission_revision,
      (SELECT count(*)::int FROM public.music_voice_events WHERE profile_id=$1 AND event_type='submitted') events
      FROM public.music_voice_profiles WHERE id=$1`, [profile.id]);
    assert.deepEqual(counts, { status: 'pending_review', submission_revision: 1, events: 1 });

    const revokeKey = `voice-revoke-${randomUUID()}`, revokeDigest = digest('d');
    const revoke = () => one(`SELECT public.music_voice_revoke($1,$2,$3,$4,'aal2',clock_timestamp()) AS result`,
      [owner.auth, profile.id, revokeKey, revokeDigest]);
    assert.equal((await revoke()).result.idempotent, false);
    assert.equal((await revoke()).result.idempotent, true);
    counts = await one(`SELECT status,
      (SELECT count(*)::int FROM public.music_voice_events WHERE profile_id=$1 AND event_type='revoked') events,
      (SELECT count(*)::int FROM public.asset_reap_queue WHERE r2_key IN($2,$3)) queued
      FROM public.music_voice_profiles WHERE id=$1`, [profile.id, profile.reference, challenge]);
    assert.deepEqual(counts, { status: 'revoked', events: 1, queued: 2 });
  });

  it('evidence delivery acknowledgement and the admin decision are each replay-safe', async () => {
    const owner = await user(), reviewer = await user(true), profile = await directProfile(owner.id, 'pending_review');
    await client.query(`INSERT INTO public.music_voice_events(profile_id,actor_user_id,event_type,submission_revision,policy_version,created_at)
      VALUES($1,$2,'evidence_viewed',1,$3,clock_timestamp()-interval '6 seconds')`, [profile.id, reviewer.id, POLICY]);
    const acknowledge = () => one(`SELECT public.music_voice_admin_evidence_delivered($1,$2,1,'aal2',clock_timestamp()) AS result`, [reviewer.auth, profile.id]);
    assert.equal((await acknowledge()).result.ok, true);
    assert.equal((await acknowledge()).result.ok, true);
    assert.equal((await one(`SELECT count(*)::int AS n FROM public.music_voice_events WHERE profile_id=$1
      AND actor_user_id=$2 AND event_type='evidence_delivered'`, [profile.id, reviewer.id])).n, 1);

    const reviewKey = `voice-review-${randomUUID()}`, reviewDigest = digest('e');
    const checklist = { phrase_exact: true, policy_acknowledged: true, reference_consistent: true, no_synthetic_concerns: true };
    const review = () => one(`SELECT public.music_voice_admin_review($1,$2,1,'approve','evidence_consistent',$3::jsonb,$4,$5,
      'aal2',clock_timestamp(),$6) AS result`, [reviewer.auth, profile.id, JSON.stringify(checklist), reviewKey, reviewDigest, POLICY]);
    assert.equal((await review()).result.idempotent, false);
    assert.equal((await review()).result.idempotent, true);
    const counts = await one(`SELECT status,
      (SELECT count(*)::int FROM public.music_voice_events WHERE profile_id=$1 AND event_type='approved') events,
      (SELECT count(*)::int FROM public.music_voice_receipts WHERE actor_user_id=$2 AND operation='review') receipts
      FROM public.music_voice_profiles WHERE id=$1`, [profile.id, reviewer.id]);
    assert.deepEqual(counts, { status: 'verified', events: 1, receipts: 1 });
  });

  it('replaying one wrong-phrase request consumes exactly one attempt and writes one failure event', async () => {
    const owner = await user(), profile = await directProfile(owner.id);
    const idempotencyKey = `voice-submit-${randomUUID()}`, requestDigest = digest('f');
    const call = () => one(`SELECT public.music_voice_submit($1,$2,'unused','audio/wav',100,2,'wrong-proof',$3,$4,'aal2',clock_timestamp()) AS result`,
      [owner.auth, profile.id, idempotencyKey, requestDigest]);
    const first = (await call()).result, replay = (await call()).result;
    assert.deepEqual(first, { profile_id: profile.id, ok: false, code: 'CHALLENGE_MISMATCH', attempts_remaining: 2, idempotent: false });
    assert.deepEqual(replay, { profile_id: profile.id, ok: false, code: 'CHALLENGE_MISMATCH', attempts_remaining: 2, idempotent: true });
    const state = await one(`SELECT challenge_attempt_count,
      (SELECT count(*)::int FROM public.music_voice_events WHERE profile_id=$1 AND event_type='challenge_failed') failed_events,
      (SELECT count(*)::int FROM public.music_voice_receipts WHERE actor_user_id=$2 AND operation='submit' AND idempotency_key=$3) receipts
      FROM public.music_voice_profiles WHERE id=$1`, [profile.id, owner.id, idempotencyKey]);
    assert.deepEqual(state, { challenge_attempt_count: 1, failed_events: 1, receipts: 1 });
  });
});
