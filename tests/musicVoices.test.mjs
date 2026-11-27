import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  MUSIC_VOICE_CHALLENGE_MAX_SECONDS,
  MUSIC_VOICE_CONSENT_VERSION,
  MUSIC_VOICE_REFERENCE_MAX_SECONDS,
  createMusicVoiceChallenge,
  createMusicVoiceNonce,
  freshMusicVoiceMfa,
  musicVoiceChallengeProof,
  musicVoiceRequestDigest,
  musicVoicesReady,
  musicVoicesSchemaReady,
  openMusicVoiceChallenge,
  parseMusicVoiceEnrollment,
  parseMusicVoiceEvidence,
  parseMusicVoiceIdempotency,
  parseMusicVoiceReview,
  parseMusicVoiceVerification,
  publicMusicVoiceProfile,
  sealMusicVoiceChallenge,
  validMusicVoiceAudio,
} from '../lib/musicVoices.js';
import { musicVoiceReadContext } from '../lib/musicVoiceRuntime.js';

const id = '9ca2c67a-d66f-4fc8-bd98-3ac763aab020';
const source = `music-voice-uploads/${id}/1891763e-9988-43f1-8733-da5ab3e9568f.wav`;
const secret = 'voice-test-secret-that-is-longer-than-thirty-two-bytes';
const request = (aal = 'aal2', at = '1000') => new Request('https://example.test', {
  headers: { 'x-veyrnox-auth-aal': aal, 'x-veyrnox-auth-mfa-at': at },
});

test('voice rollout stays fail-closed until every gate and secret are ready', () => {
  const ready = { MUSIC_SCHEMA_ENABLED: 'true', MUSIC_LIBRARY_ENABLED: 'true', MUSIC_RUNTIME_FLAGS: '{"voices":true}',
    MUSIC_VOICES_SCHEMA_ENABLED: 'true', UPLOAD_INTEGRITY_ENABLED: 'true', MUSIC_VOICE_CHALLENGE_SECRET: secret };
  assert.equal(musicVoicesReady(ready), true);
  for (const key of ['MUSIC_SCHEMA_ENABLED', 'MUSIC_LIBRARY_ENABLED', 'MUSIC_VOICES_SCHEMA_ENABLED', 'UPLOAD_INTEGRITY_ENABLED', 'MUSIC_VOICE_CHALLENGE_SECRET']) {
    assert.equal(musicVoicesReady({ ...ready, [key]: undefined }), false, key);
  }
  assert.equal(musicVoicesReady({ ...ready, MUSIC_RUNTIME_FLAGS: '{}' }), false);
  assert.equal(musicVoicesSchemaReady(ready), true);
  assert.equal(musicVoicesSchemaReady({ ...ready, MUSIC_VOICES_SCHEMA_ENABLED: 'false' }), false);
});

test('status reads and consent withdrawal survive the runtime kill switch', () => {
  const req = new Request('https://example.test', { headers: { 'x-veyrnox-auth-id': id } });
  const enabled = musicVoiceReadContext(req, {
    env: { MUSIC_VOICES_SCHEMA_ENABLED: 'true', MUSIC_RUNTIME_FLAGS: '{}' },
    cfg: { supabaseUrl: 'https://db.example.test', serviceRoleKey: 'test-only' },
  });
  assert.equal(enabled.authId, id);
  assert.equal(enabled.error, undefined);
  const disabled = musicVoiceReadContext(req, {
    env: { MUSIC_VOICES_SCHEMA_ENABLED: 'false', MUSIC_RUNTIME_FLAGS: '{"voices":true}' },
    cfg: { supabaseUrl: 'https://db.example.test', serviceRoleKey: 'test-only' },
  });
  assert.equal(disabled.error.status, 404);
});

test('owner enrollment requires exact consent and all self-attestations', () => {
  const valid = { name: 'My singing voice', reference_source_key: source, owner_attestation: true,
    adult_attestation: true, eligible_region_attestation: true, consent_version: MUSIC_VOICE_CONSENT_VERSION,
    idempotency_key: 'voice-enroll-1' };
  assert.deepEqual(parseMusicVoiceEnrollment(valid), { ok: true, name: valid.name, referenceKey: source,
    idempotencyKey: valid.idempotency_key });
  assert.equal(parseMusicVoiceEnrollment({ ...valid, adult_attestation: false }).error, 'attestation_required');
  assert.equal(parseMusicVoiceEnrollment({ ...valid, consent_version: 'old' }).error, 'consent_stale');
  assert.equal(parseMusicVoiceEnrollment({ ...valid, extra: true }).error, 'invalid_request');
});

test('live submission, recovery and review bodies are narrow', () => {
  const verified = parseMusicVoiceVerification({ challenge_source_key: source, phrase: '  Amber   River  123456 ',
    live_recording_attestation: true, idempotency_key: 'voice-verify-1' });
  assert.equal(verified.ok, true);
  assert.equal(verified.phrase, 'amber river 123456');
  assert.equal(parseMusicVoiceVerification({ challenge_source_key: source, phrase: 'x',
    live_recording_attestation: false, idempotency_key: 'voice-verify-1' }).error, 'live_recording_required');
  assert.equal(parseMusicVoiceIdempotency({ idempotency_key: 'voice-reissue-1' }).ok, true);
  assert.equal(parseMusicVoiceEvidence({ submission_revision: 2 }).ok, true);
  const checklist = { phrase_exact: true, reference_consistent: true, no_synthetic_concerns: true, policy_acknowledged: true };
  assert.equal(parseMusicVoiceReview({ submission_revision: 2, decision: 'approve', reason_code: 'evidence_consistent',
    checklist }).ok, true);
  assert.equal(parseMusicVoiceReview({ submission_revision: 2, decision: 'approve', reason_code: 'evidence_consistent',
    checklist: { ...checklist, phrase_exact: false } }).error, 'checklist_incomplete');
  assert.equal(parseMusicVoiceReview({ submission_revision: 2, decision: 'reject', reason_code: 'evidence_consistent',
    checklist }).error, 'review_invalid');
  assert.equal(parseMusicVoiceReview({ submission_revision: 2, decision: 'approve', reason_code: 'policy_failed',
    checklist }).error, 'review_invalid');
});

test('fresh MFA is always five minutes and future bounded', () => {
  assert.equal(freshMusicVoiceMfa(request(), 1200), 1000);
  assert.equal(freshMusicVoiceMfa(request(), 1301), null);
  assert.equal(freshMusicVoiceMfa(request('aal1'), 1200), null);
  assert.equal(freshMusicVoiceMfa(request('aal2', '1206'), 1200), null);
});

test('challenge phrase, HMAC proof and sealed reviewer copy are deterministic under injected randomness', async () => {
  const random = bytes => { for (let index = 0; index < bytes.length; index += 1) bytes[index] = index; return bytes; };
  const phrase = createMusicVoiceChallenge(random);
  assert.equal(phrase.split(' ').length, 9);
  assert.match(phrase, / \d{6}$/);
  const nonce = createMusicVoiceNonce(random);
  const proof = await musicVoiceChallengeProof({ profileId: id, nonce, phrase }, secret);
  const normalizedProof = await musicVoiceChallengeProof({ profileId: id, nonce, phrase: phrase.toUpperCase() }, secret);
  assert.equal(proof, normalizedProof);
  assert.notEqual(proof, await musicVoiceChallengeProof({ profileId: id, nonce, phrase: `${phrase} wrong` }, secret));
  const sealed = await sealMusicVoiceChallenge({ profileId: id, phrase }, secret, random);
  assert.equal(await openMusicVoiceChallenge({ profileId: id, sealed }, secret), phrase);
  assert.equal(await openMusicVoiceChallenge({ profileId: id, sealed }, `${secret}wrong`), null);
});

test('request digests bind canonical inputs and audio limits are explicit', async () => {
  assert.equal(await musicVoiceRequestDigest({ a: 1 }), await musicVoiceRequestDigest({ a: 1 }));
  assert.notEqual(await musicVoiceRequestDigest({ a: 1 }), await musicVoiceRequestDigest({ a: 2 }));
  assert.equal(validMusicVoiceAudio('audio/wav', 1024, 30, MUSIC_VOICE_REFERENCE_MAX_SECONDS), true);
  assert.equal(validMusicVoiceAudio('audio/mpeg', 1024, 30, MUSIC_VOICE_CHALLENGE_MAX_SECONDS), true);
  assert.equal(validMusicVoiceAudio('video/mp4', 1024, 30, MUSIC_VOICE_REFERENCE_MAX_SECONDS), false);
  assert.equal(validMusicVoiceAudio('audio/wav', 1024, 0, MUSIC_VOICE_REFERENCE_MAX_SECONDS), false);
});

test('owner projection cannot leak evidence, phrase or reviewer identity', () => {
  const profile = publicMusicVoiceProfile({ id, name: 'Mine', status: 'pending_review', submission_revision: 2,
    challenge_hmac: 'secret', challenge_ciphertext: 'secret', reference_source_key: source,
    reviewer_user_id: id, created_at: '2026-11-24T00:00:00Z' });
  assert.deepEqual(Object.keys(profile).sort(), ['challenge_expires_at', 'created_at', 'id', 'name', 'reason_code',
    'review_expires_at', 'status', 'submission_revision', 'updated_at', 'verification_expires_at', 'verified_at'].sort());
  assert.equal(profile.reason_code, null);
  assert.equal(publicMusicVoiceProfile({ id, name: 'Mine', status: 'rejected',
    reason_code: 'synthetic_suspected' }).reason_code, 'not_verified');
});

test('the migration preserves evidence accountability without retaining content in receipts', async () => {
  const [sql, accountDeletion, privacyExport] = await Promise.all([
    readFile(new URL('../packages/db/schema/supabase/0623_music_voice_verification.sql', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/test-account-deletion.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/test-privacy-export.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(sql, /BEGIN;[\s\S]*CREATE SCHEMA IF NOT EXISTS private;/);
  assert.match(sql, /REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/g);
  assert.match(sql, /music_voice_events_immutable/);
  assert.match(sql, /append-only \(attempted TRUNCATE\)/);
  assert.match(sql, /p_path IN \([\s\S]*'\/app\/music\/voices'[\s\S]*'\/app\/admin\/music-voices'[\s\S]*telemetry_path_allowed_pre_0618/);
  assert.match(sql, /music_voice_events_actor_idx[\s\S]*music_voice_events\(actor_user_id\)/);
  assert.match(sql, /music_voice_source_tombstones_profile_idx[\s\S]*music_voice_source_tombstones\(profile_id\)/);
  assert.match(sql, /music_voice_receipts_immutable/);
  assert.match(sql, /music_voice_source_tombstones_immutable/);
  assert.doesNotMatch(sql, /jsonb_object_length/);
  assert.match(sql, /checklist-'phrase_exact'-'reference_consistent'-'no_synthetic_concerns'-'policy_acknowledged'='\{\}'::jsonb/);
  assert.doesNotMatch(sql, /INSERT INTO public\.music_voice_receipts[^;]*private\.music_voice_json/s);
  assert.match(sql, /result:=jsonb_build_object\('profile_id',v\.id\)/);
  assert.match(sql, /'profile',private\.music_voice_json\(v\),'created',false,'idempotent',true/);
  assert.match(sql, /'profile',private\.music_voice_json\(v\),'reissued',false,'idempotent',true/);
  assert.match(sql, /operation='submit'[\s\S]*idempotency_key=p_idem_key[\s\S]*request_digest/);
  assert.match(sql, /seen\.result->>'code' IS NOT NULL THEN RETURN seen\.result\|\|jsonb_build_object\('idempotent',true\)/);
  assert.match(sql, /'code','CHALLENGE_MISMATCH'[\s\S]*INSERT INTO public\.music_voice_receipts VALUES\(u,'submit',p_idem_key,p_request_digest,result/);
  assert.match(sql, /music_voice_challenge_context\(p_auth_id TEXT,p_profile_id UUID,p_idem_key TEXT,p_request_digest TEXT\)[\s\S]*seen\.request_digest<>p_request_digest[\s\S]*IDEMPOTENCY_CONFLICT/);
  assert.match(sql, /music_voice_enroll_context\(p_auth_id TEXT,p_idem_key TEXT,p_request_digest TEXT\)[\s\S]*operation='enroll'[\s\S]*seen\.request_digest<>p_request_digest[\s\S]*private\.music_voice_json\(v\)/);
  assert.match(sql, /status='pending_review'[\s\S]*challenge_size_bytes=p_challenge_size,challenge_duration_seconds=p_challenge_seconds,[\s\S]*submission_revision/);
  assert.match(sql, /v\.status IN\('challenge_issued','pending_review','verified'\) THEN PERFORM private\.music_voice_queue_media/);
  assert.match(sql, /music_voice_protected_uploads[\s\S]*status IN\('challenge_issued','pending_review','verified'\)/);
  assert.match(sql, /music_voice_upload_protected[\s\S]*reference_source_key=p_key OR challenge_source_key=p_key/);
  assert.match(sql, /asset_reap_allowed[\s\S]*music_voice_profiles[\s\S]*reference_source_key=p_key OR challenge_source_key=p_key/);
  assert.match(sql, /music_voice_source_tombstones[\s\S]*encode\(sha256\(convert_to\(p_reference_key,'UTF8'\)\),'hex'\)/);
  assert.match(sql, /music_voice_source_unbound[\s\S]*music_source_assets[\s\S]*source_keys[\s\S]*references/);
  assert.match(sql, /DELETE FROM public\.upload_reservations WHERE r2_key=p_reference_key AND user_id=u/);
  assert.match(sql, /DELETE FROM public\.upload_reservations WHERE r2_key=p_challenge_key AND user_id=u/);
  assert.match(sql, /p_reference_key!~\('\^music-voice-uploads\/'\|\|lower\(p_auth_id\)/);
  assert.match(sql, /p_challenge_key!~\('\^music-voice-uploads\/'\|\|lower\(p_auth_id\)/);
  assert.match(sql, /asset_reap_queue WHERE r2_key=p_reference_key/);
  assert.match(sql, /actor=v\.user_id[\s\S]*SELF_REVIEW_FORBIDDEN/);
  assert.match(sql, /SELECT id INTO actor[\s\S]*IF actor IS NULL THEN RAISE EXCEPTION 'not_admin'/);
  assert.match(sql, /event_type='evidence_viewed'[\s\S]*interval '10 minutes'/);
  assert.match(sql, /event_type='evidence_viewed'[\s\S]*interval '30 seconds'[\s\S]*interval '1 hour'/);
  assert.match(sql, /music_voice_admin_evidence_delivered[\s\S]*'evidence_delivered'/);
  assert.match(sql, /event_type='evidence_delivered'[\s\S]*interval '10 minutes'[\s\S]*EVIDENCE_NOT_DELIVERED/);
  assert.match(sql, /event_type='evidence_viewed'[\s\S]*interval '10 minutes'[\s\S]*interval '5 seconds'/);
  assert.match(sql, /status='revoked',reference_source_key=NULL,reference_mime_type=NULL[\s\S]*challenge_source_key=NULL,challenge_mime_type=NULL/);
  assert.match(sql, /name='Removed voice'[\s\S]*event_type,submission_revision,reason_code,policy_version/);
  assert.match(sql, /event_type,submission_revision,reason_code,checklist,policy_version\)[\s\S]*'approved'[\s\S]*p_checklist/);
  assert.match(sql, /p_decision='approve' THEN PERFORM private\.music_voice_queue_media[\s\S]*status='verified'[\s\S]*reference_source_key=NULL/);
  assert.match(sql, /deadline:=clock_timestamp\(\)\+interval '16 minutes'/);
  assert.match(sql, /created_at>clock_timestamp\(\)-interval '20 hours'/);
  assert.match(sql, /event_type='enrolled'[\s\S]*interval '24 hours'\)>=3[\s\S]*status='rejected'[\s\S]*interval '1 hour'[\s\S]*RATE_LIMITED/);
  assert.match(sql, /WHERE v\.status='pending_review' AND v\.review_expires_at>clock_timestamp\(\)/);
  assert.match(sql, /WHEN r\.status='verified' AND r\.verification_expires_at<=clock_timestamp\(\) THEN 'expired'/);
  assert.match(sql, /SELECT id INTO u FROM public\.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;/);
  assert.match(sql, /FOR v IN SELECT \* FROM public\.music_voice_profiles WHERE user_id=u AND \(\(status='challenge_issued'/);
  assert.match(sql, /'moderator':?\[|"moderator":\[/);
  assert.match(sql, /"moderator":\[[^\]]*"music_voices\.review"/);
  assert.doesNotMatch(sql, /"moderator":\[[^\]]*"music_voices\.approve"/);
  assert.match(sql, /CASE WHEN p_decision='approve' THEN 'music_voices\.approve'/);
  assert.match(accountDeletion, /'music_voice_profiles', 'music_voice_events', 'music_voice_receipts'/);
  assert.match(accountDeletion, /music_voice_source_tombstones', 'retained_via_profile_owner'/);
  assert.match(privacyExport, /'music_voice_profiles', 'music_voice_events', 'music_voice_receipts'/);
  const revoke = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.music_voice_revoke'),
    sql.indexOf('-- Extend the complete 0428 matrix'));
  assert.doesNotMatch(revoke, /music_voice_fresh_mfa/);
});

test('choosing a replacement challenge recording invalidates the cached upload attempt', async () => {
  const [web, native, upload] = await Promise.all([
    readFile(new URL('../app/veyrnox/_components/music/MusicVoices.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile/src/app/(app)/music/voices.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/v1/uploads/route.js', import.meta.url), 'utf8'),
  ]);
  assert.match(web, /selectLiveRecording[\s\S]*delete attempts\.current\.submit;[\s\S]*setLiveRecording\(file\)/);
  assert.match(web, /music-voice-live-recording[\s\S]*selectLiveRecording\(event\.target\.files\?\.\[0\] \|\| null\)/);
  assert.match(web, /purpose: 'music_voice_evidence'/);
  assert.match(native, /changeReference[\s\S]*delete attempts\.current\.enroll/);
  assert.match(native, /changeTake[\s\S]*delete attempts\.current\.submit/);
  assert.match(native, /Platform\.OS === 'ios'[\s\S]*pickTake[\s\S]*music-voice-recording-file/);
  assert.match(upload, /music_voice_evidence[\s\S]*MUSIC_VOICE_UPLOAD_PREFIX/);
});

test('route replay branches never disclose a freshly generated unstored phrase', async () => {
  const route = await readFile(new URL('../app/api/v1/music/voices/[[...voicePath]]/route.js', import.meta.url), 'utf8');
  const enroll = route, reissue = route, submit = route;
  for (const source of [enroll, reissue]) {
    assert.match(source, /result\.idempotent !== true/);
    assert.match(source, /challenge_reissue_required: true/);
  }
  assert.match(enroll, /music_voice_enroll_context[\s\S]*replay === true[\s\S]*challenge_reissue_required: true/);
  assert.match(enroll, /const digest = await musicVoiceRequestDigest[\s\S]*music_voice_enroll_context[\s\S]*inspectMusicVoiceUpload/);
  assert.match(submit, /music_voice_challenge_context[\s\S]*p_idem_key: input\.idempotencyKey/);
  assert.match(submit, /const digest = await musicVoiceRequestDigest[\s\S]*music_voice_challenge_context[\s\S]*p_request_digest: digest/);
  assert.match(submit, /challenge\.replay === true[\s\S]*p_request_digest: digest/);
});

test('owner read and revoke routes use the kill-switch-safe context and header idempotency', async () => {
  const [collection, page, library] = await Promise.all([
    readFile(new URL('../app/api/v1/music/voices/[[...voicePath]]/route.js', import.meta.url), 'utf8'),
    readFile(new URL('../app/veyrnox/app/music/voices/page.js', import.meta.url), 'utf8'),
    readFile(new URL('../app/veyrnox/app/music/library/page.js', import.meta.url), 'utf8'),
  ]);
  assert.match(collection, /listVoices[\s\S]*musicVoiceReadContext\(request\)/);
  assert.match(collection, /enrollment_available:\s*musicVoicesReady\(ctx\.env\)/);
  assert.match(collection, /revokeVoice[\s\S]*musicVoiceReadContext\(request\)/);
  assert.match(collection, /headers\.get\('idempotency-key'\)/);
  assert.doesNotMatch(collection, /revokeVoice[\s\S]*requireMfa:\s*true/);
  assert.match(page, /musicVoicesSchemaReady\(\)/);
  assert.match(library, /voicesEnabled=\{musicVoicesSchemaReady\(\)\}/);
});

test('every admin voice route is bound to the same default-off readiness gate', async () => {
  const route = await readFile(new URL('../app/api/v1/admin/music/voices/[[...voicePath]]/route.js', import.meta.url), 'utf8');
  assert.match(route, /adminContext[\s\S]*musicVoicesReady\(\)/);
  assert.match(route, /error: 'not_found'[^\n]*404/);
});
