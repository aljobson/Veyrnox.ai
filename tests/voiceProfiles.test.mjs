import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DELETION_BLOCKERS } from '../lib/accountDeletion.js';
import { VOICE_CONSENT_VERSION, VOICE_PROFILE_LIMIT, VOICE_SAMPLE_MAX_SECONDS, VOICE_SAMPLE_MIN_SECONDS, publicProfile, recentMfa, validCreateBody } from '../lib/voiceProfiles.js';

const request = (headers = {}) => new Request('https://example.test', { headers });

test('voice profile creation requires the exact owner attestation', () => {
  assert.deepEqual(validCreateBody({ name: ' Mine ', language: 'en', owner_attestation: true, consent_version: VOICE_CONSENT_VERSION }), { name: 'Mine', language: 'en' });
  for (const body of [null, {}, { name: 'Mine', language: 'en', owner_attestation: false, consent_version: VOICE_CONSENT_VERSION }, { name: 'Mine', language: 'en', owner_attestation: true, consent_version: 'old' }]) {
    assert.equal(validCreateBody(body), null);
  }
});

test('voice mutations require a server-verified AAL2 TOTP in the last five minutes', () => {
  const now = 2_000_000_000;
  assert.equal(recentMfa(request({ 'x-veyrnox-auth-aal': 'aal2', 'x-veyrnox-auth-mfa-at': String(now - 10) }), now), now - 10);
  assert.equal(recentMfa(request({ 'x-veyrnox-auth-aal': 'aal1', 'x-veyrnox-auth-mfa-at': String(now) }), now), null);
  assert.equal(recentMfa(request({ 'x-veyrnox-auth-aal': 'aal2', 'x-veyrnox-auth-mfa-at': String(now - 301) }), now), null);
});

test('public profiles never expose provider handles', () => {
  assert.deepEqual(publicProfile({ id: 'one', name: 'Mine', provider_voice_id: 'secret-handle' }), { id: 'one', name: 'Mine' });
});

test('account deletion cannot orphan a provider voice', async () => {
  assert.ok(DELETION_BLOCKERS.includes('voice_profile_present'));
  const migration = await readFile(new URL('../packages/db/schema/supabase/0390_verified_voice_profiles.sql', import.meta.url), 'utf8');
  assert.match(migration, /voice_profile_present/);
  assert.match(migration, /status<>'revoked'/);
  assert.match(migration, /erase_revoked_voice_profiles/);
  assert.match(migration, /RECENT_MFA_REQUIRED/);
  assert.match(migration, /voice_profile_record_sample/);
  assert.match(migration, /sample_seconds>=1800/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS voice_profiles_one_active_user_idx/);
  assert.match(migration, /EXCEPTION WHEN unique_violation/);
  assert.equal(VOICE_PROFILE_LIMIT, 1);
  assert.equal(VOICE_SAMPLE_MIN_SECONDS, 1800);
  assert.equal(VOICE_SAMPLE_MAX_SECONDS, 10800);
});
