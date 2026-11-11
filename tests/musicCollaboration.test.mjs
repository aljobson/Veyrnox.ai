import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { musicCollaborationEnabled, parseMusicCollaboration } from '../lib/musicCollaboration.js';

const migrationUrl = new URL('../packages/db/schema/supabase/0471_music_workspace_collaboration.sql', import.meta.url);

test('collaboration parsers accept only exact handle invite and response shapes', () => {
  const workspace = 'a5ed2d0d-8276-4fbb-9c4f-39f401a3158b';
  const invitation = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';
  assert.equal(parseMusicCollaboration({ action: 'profile', handle: 'Harbour_Writer', display_name: 'Harbour Writer' }).handle, 'harbour_writer');
  assert.equal(parseMusicCollaboration({ action: 'invite', workspace_id: workspace, handle: 'guest_one', idempotency_key: 'invite.123456' }).ok, true); // gitleaks:allow -- synthetic idempotency fixture
  assert.equal(parseMusicCollaboration({ action: 'respond', invitation_id: invitation, decision: 'accept', idempotency_key: 'reply.123456' }).ok, true); // gitleaks:allow -- synthetic idempotency fixture
  assert.equal(parseMusicCollaboration({ action: 'invite', workspace_id: workspace, handle: 'guest_one', idempotency_key: 'invite.123456', role: 'owner' }).error, 'invalid_request'); // gitleaks:allow -- synthetic idempotency fixture
  assert.equal(parseMusicCollaboration({ action: 'respond', invitation_id: invitation, decision: 'owner', idempotency_key: 'reply.123456' }).error, 'response_invalid'); // gitleaks:allow -- synthetic idempotency fixture
  assert.equal(musicCollaborationEnabled({ MUSIC_SCHEMA_ENABLED: 'true', MUSIC_LIBRARY_ENABLED: 'true', MUSIC_COLLABORATION_ENABLED: 'true' }), true);
});

test('workspace collaboration is owner-managed, capped, replay-safe and service-role-only', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /role IN \('owner','collaborator'\)/);
  assert.match(sql, /WHERE id=p_workspace_id AND user_id=v_owner[\s\S]*FOR UPDATE/);
  assert.match(sql, /count\(\*\)[\s\S]*>=10/);
  assert.match(sql, /IF FOUND THEN[\s\S]*'IDEMPOTENCY_CONFLICT'[\s\S]*'idempotent',true/);
  assert.match(sql, /WHERE id=p_invitation_id AND invitee_id=v_user FOR UPDATE/);
  assert.match(sql, /role='collaborator',status='active'/);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*authenticated/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]*TO authenticated/);
});
