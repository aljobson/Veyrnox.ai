'use client';

// Browser side of Chat (ADR-0067). JSON calls go through gatewayFetch; a streamed reply needs the raw token,
// so sendTurn repeats the gateway's sign-in handling for it.

import { getFreshAccessToken, getSession, clearSession } from '../../lib/authClient.js';
import { gatewayFetch, GatewayError, ACCOUNT_PAUSED_COPY, makeIdempotencyKey, notifyBalanceChanged } from './gateway';

const json = (body) => JSON.stringify(body);

export const chatApi = {
  models: () => gatewayFetch('/chat/models'),
  threads: () => gatewayFetch('/chat/threads'),
  create: (modelId) => gatewayFetch('/chat/threads', { method: 'POST', body: json({ model_id: modelId }) }),
  get: (id) => gatewayFetch(`/chat/threads/${encodeURIComponent(id)}`),
  patch: (id, patch) => gatewayFetch(`/chat/threads/${encodeURIComponent(id)}`, { method: 'PATCH', body: json(patch) }),
  remove: (id) => gatewayFetch(`/chat/threads/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  folders: () => gatewayFetch('/chat/folders'),
  createFolder: (name) => gatewayFetch('/chat/folders', { method: 'POST', body: json({ name }) }),
  renameFolder: (id, name) => gatewayFetch(`/chat/folders/${encodeURIComponent(id)}`, { method: 'PATCH', body: json({ name }) }),
  removeFolder: (id) => gatewayFetch(`/chat/folders/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  personas: () => gatewayFetch('/chat/personas'),
  savePersona: (p) => gatewayFetch('/chat/personas', { method: 'POST', body: json(p) }),
  updatePersona: (id, p) => gatewayFetch(`/chat/personas/${encodeURIComponent(id)}`, { method: 'PATCH', body: json(p) }),
  removePersona: (id) => gatewayFetch(`/chat/personas/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  move: (id, folderId) => gatewayFetch(`/chat/threads/${encodeURIComponent(id)}`, { method: 'PATCH', body: json({ folder_id: folderId }) }),
};

/** What the user is told. Plain, specific, and always whether Credits were used (UI-UX.md section 8). */
export function chatErrorCopy(code, { credits } = {}) {
  switch (code) {
    case 'insufficient_balance': return `You need ${credits ?? 'more'} Credits for this reply. Top up to continue. Your message was not sent.`;
    case 'account_frozen': return ACCOUNT_PAUSED_COPY;
    case 'rate_limited': return 'You are sending messages quickly. Wait a few seconds and try again.';
    case 'chat_not_open': return 'Chat is not open yet.';
    case 'thread_not_found': return 'That chat no longer exists.';
    case 'search_unavailable': return 'Web search is not working right now. Turn it off or try again. No Credits were used.';
    case 'search_timeout': return 'Web search took too long. Try again, or turn it off. No Credits were used.';
    case 'search_rate_limited': return 'Web search is busy. Try again in a moment. No Credits were used.';
    case 'search_no_results': return 'No pages came back for that. Try again without Web search. No Credits were used.';
    case 'folder_not_found': return 'That folder no longer exists.';
    case 'folder_exists': return 'You already have a folder with that name.';
    case 'folder_limit': return 'You can have up to 50 folders. Delete one to make another.';
    case 'invalid_name': return 'Folder names can be 1 to 60 characters.';
    case 'persona_not_found': return 'That persona no longer exists.';
    case 'persona_exists': return 'You already have a persona with that name.';
    case 'persona_limit': return 'You can have up to 20 personas. Delete one to make another.';
    case 'invalid_persona_name': return 'Persona names can be 1 to 60 characters.';
    case 'invalid_instructions': return 'Instructions can be 1 to 4,000 characters.';
    case 'personas_unavailable': return 'Personas are not available yet.';
    case 'model_unavailable': case 'model_gated': case 'model_not_found': return 'That model is not available right now. Pick another. No Credits were used.';
    case 'option_unavailable': case 'invalid_options': return 'That option is not available for this model. Turn it off or pick another model. No Credits were used.';
    case 'attachment_not_found': case 'attachment_invalid': return 'We could not read that image. Remove it and attach it again. No Credits were used.';
    case 'attachment_type_unsupported': return 'Only PNG, JPEG and WebP images can be attached. No Credits were used.';
    case 'image_too_large': return 'That image is too large. Images can be up to 2048 pixels on the long side. No Credits were used.';
    case 'attachment_check_failed': return 'We could not check your image just now. Try again. No Credits were used.';
    case 'invalid_attachments': return 'You can attach up to 4 different images. No Credits were used.';
    case 'upload_failed': case 'image_unreadable': return 'The image did not upload. Try again, or pick another. No Credits were used.';
    case 'invalid_text': return 'Messages can be up to 8,000 characters.';
    case 'turn_not_saved': return 'We could not save that reply, so you will not be charged.';
    case 'provider_cut_off': case 'provider_dropped': return 'The reply was cut off. No Credits were used.';
    default: return code && code.startsWith('provider_')
      ? 'The model did not finish. No Credits were used. Try again, or pick another model.'
      : "That didn't work. Try again.";
  }
}

export { makeIdempotencyKey };

/**
 * Send one message and stream the reply. Calls onEvent(name, data) for start, delta, error, done.
 * Resolves { replay: true } when the same send already ran. Throws GatewayError for a refusal before the stream.
 * Aborting `signal` is the Stop button.
 */
export async function sendTurn({ threadId, text, key, options, attachments = [], signal, onEvent }) {
  const token = await getFreshAccessToken();
  if (!token) {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('veyrnox:auth-required'));
    throw new GatewayError('not authenticated', { status: 401, code: 'no_token' });
  }
  const res = await fetch(`/api/v1/chat/threads/${encodeURIComponent(threadId)}/messages`, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: json({
      text, idempotency_key: key, options: { thinking: options?.thinking === true, web: options?.web === true },
      ...(attachments.length ? { attachments: attachments.map((source_key) => ({ source_key })) } : {}),
    }),
  });
  if (res.status === 401) {
    if (getSession()?.access_token === token) clearSession();
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('veyrnox:auth-required'));
    throw new GatewayError('unauthenticated', { status: 401, code: 'unauthenticated' });
  }
  if (!(res.headers.get('content-type') || '').includes('text/event-stream')) {
    let body = null;
    try { body = await res.json(); } catch { /* no body */ }
    if (res.ok && body?.replay) return { replay: true };
    throw new GatewayError(body?.error || `HTTP ${res.status}`, { status: res.status, code: body?.error || 'gateway_error', body });
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      if (!event || !data) continue;
      try { onEvent(event, JSON.parse(data)); } catch { /* a malformed frame is skipped, the stream goes on */ }
    }
  }
  notifyBalanceChanged();
  return { replay: false };
}

/**
 * Put one image in R2 on the 15-minute URL the gateway signs (ADR-0028) and return its key. Nothing is charged
 * here: the upload happens before the debit, so a failure costs nothing.
 */
export async function uploadChatImage(file) {
  const up = await gatewayFetch('/uploads', { method: 'POST', body: JSON.stringify({ content_type: file.type, size_bytes: file.size }) });
  let put;
  try {
    put = await fetch(up.upload_url, { method: 'PUT', headers: up.headers || { 'Content-Type': up.content_type }, body: file });
  } catch {
    throw new GatewayError('upload_failed', { status: 0, code: 'upload_failed' });
  }
  if (!put.ok) throw new GatewayError('upload_failed', { status: put.status, code: 'upload_failed' });
  return up.key;
}
