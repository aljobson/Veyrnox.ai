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
};

/** What the user is told. Plain, specific, and always whether Credits were used (UI-UX.md section 8). */
export function chatErrorCopy(code, { credits } = {}) {
  switch (code) {
    case 'insufficient_balance': return `You need ${credits ?? 'more'} Credits for this reply. Top up to continue. Your message was not sent.`;
    case 'account_frozen': return ACCOUNT_PAUSED_COPY;
    case 'rate_limited': return 'You are sending messages quickly. Wait a few seconds and try again.';
    case 'chat_not_open': return 'Chat is not open yet.';
    case 'thread_not_found': return 'That chat no longer exists.';
    case 'model_unavailable': case 'model_gated': case 'model_not_found': return 'That model is not available right now. Pick another. No Credits were used.';
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
export async function sendTurn({ threadId, text, key, signal, onEvent }) {
  const token = await getFreshAccessToken();
  if (!token) {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('veyrnox:auth-required'));
    throw new GatewayError('not authenticated', { status: 401, code: 'no_token' });
  }
  const res = await fetch(`/api/v1/chat/threads/${encodeURIComponent(threadId)}/messages`, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: json({ text, idempotency_key: key }),
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
