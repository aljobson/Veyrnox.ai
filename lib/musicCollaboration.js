import { readMusicJson, validMusicAuthId, musicLibraryEnabled } from './musicBackend.js';
import { musicRuntimeFlag } from './musicRuntime.js';

import { isUuid } from './validate.js';
const HANDLE = /^[a-z][a-z0-9_]{2,29}$/;
const KEY = /^[A-Za-z0-9._-]{8,120}$/;

export const musicCollaborationEnabled = (env = process.env) => musicLibraryEnabled(env)
  && musicRuntimeFlag('collaboration', env);

export function parseMusicCollaboration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.action !== 'string') return { ok: false, error: 'invalid_request' };
  const keys = Object.keys(value).sort().join(',');
  if (value.action === 'profile' && keys === 'action,display_name,handle') {
    const handle = typeof value.handle === 'string' ? value.handle.trim().toLowerCase() : '';
    const displayName = typeof value.display_name === 'string' ? value.display_name.trim() : '';
    return HANDLE.test(handle) && displayName.length >= 1 && displayName.length <= 80
      ? { ok: true, action: 'profile', handle, displayName }
      : { ok: false, error: 'profile_invalid' };
  }
  if (value.action === 'invite' && keys === 'action,handle,idempotency_key,workspace_id') {
    const handle = typeof value.handle === 'string' ? value.handle.trim().toLowerCase() : '';
    return isUuid(value.workspace_id || '') && HANDLE.test(handle) && KEY.test(value.idempotency_key || '')
      ? { ok: true, action: 'invite', workspaceId: value.workspace_id, handle, idempotencyKey: value.idempotency_key }
      : { ok: false, error: 'invitation_invalid' };
  }
  if (value.action === 'respond' && keys === 'action,decision,idempotency_key,invitation_id') {
    return isUuid(value.invitation_id || '') && ['accept', 'decline'].includes(value.decision) && KEY.test(value.idempotency_key || '')
      ? { ok: true, action: 'respond', invitationId: value.invitation_id, decision: value.decision, idempotencyKey: value.idempotency_key }
      : { ok: false, error: 'response_invalid' };
  }
  return { ok: false, error: 'invalid_request' };
}

export { readMusicJson, validMusicAuthId };
