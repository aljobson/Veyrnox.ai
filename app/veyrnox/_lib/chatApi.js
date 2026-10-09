'use client';

// Browser side of Chat (ADR-0067). JSON calls go through gatewayFetch; a streamed reply needs the raw token,
// so sendTurn repeats the gateway's sign-in handling for it.

import { getFreshAccessToken, getSession, clearSession } from '../../lib/authClient.js';
import { turnOptions } from './chatTurnOptions';
import { lostNotice, settleStoppedTurn } from './chatStop';
import { askSend } from './chatWarning';
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
  // A reply is a job (ADR-0067): its state, by the id the `start` event carries.
  job: (id) => gatewayFetch(`/jobs/${encodeURIComponent(id)}`),
  // A send that was stopped before `start` has no job id here. The server is asked by the send's own key: it answers
  // with the job that send made, or, when it made none, closes the key so none can be made, and says `closed`.
  closeSend: (key) => gatewayFetch('/chat/sends/close', { method: 'POST', body: json({ idempotency_key: key }) }),
  // The same question at once, for a send whose own request went out and got no answer before `start` (sendTurn below):
  // `{ closed: true }`, `{ job }`, or null when the server gave no answer to act on. Never throws (chatWarning.js).
  askSend: (key) => askSend({ key, closeSend: chatApi.closeSend }),
  // After Stop or a dropped connection: look for the turn until it has settled ('saved', 'unsaved', 'nothing' or 'pending'),
  // then have the nav read the balance again. The balance moved at the debit and moves back on a refund, so it is read last.
  settleStop: async ({ threadId, jobId, text, knownIds }) => {
    const outcome = await settleStoppedTurn({ jobId, text, knownIds, getThread: () => chatApi.get(threadId), getJob: chatApi.job });
    notifyBalanceChanged();
    return outcome;
  },
};

/** What the user is told. Plain, specific, and always whether Credits were used (UI-UX.md section 8). */
export function chatErrorCopy(code, { credits } = {}) {
  switch (code) {
    case 'insufficient_balance': return `You need ${credits ?? 'more'} Credits for this reply. Top up to continue. Your message was not sent.`;
    case 'account_frozen': return ACCOUNT_PAUSED_COPY;
    case 'rate_limited': return 'You are sending messages quickly. Wait a few seconds and try again.';
    case 'chat_not_open': return 'LLM Chat is not open yet.';
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
    case 'reply_not_saved': return 'We could not save that reply to the chat. You received it, so its Credits were used.';
    case 'provider_cut_off': case 'provider_dropped': return 'The reply was cut off. No Credits were used.';
    case 'connection_lost': return 'The connection dropped before the reply finished. It may have used Credits. Check this chat before you send again.';
    case 'connection_saved': return 'The connection dropped before the reply finished. This chat shows what was saved and the Credits it used.';
    case 'connection_refunded': return 'The connection dropped before the reply finished. Nothing was saved and no Credits were used. Your message is back in the box.';
    case 'stop_saving': return 'Stopped. We are still saving this reply, and it may use Credits. Open this chat again in a moment to see what was kept.';
    case 'stop_refunded': return 'Stopped. Nothing was saved and no Credits were used. Your message is back in the box.';
    case 'stop_saved': return 'A reply was saved after you pressed Stop. This chat shows it and its price. You do not need to send that message again.';
    case 'turns_settled': return 'Some messages here ended before we knew if they were saved. Each reply that was saved now shows in this chat with its price. A message that does not show here used no Credits.';
    case 'stop_unsure': return 'Stopped before any text arrived. If a reply is still saved, it will show in this chat and use Credits.';
    default: return code && code.startsWith('provider_')
      ? 'The model did not finish. No Credits were used. Try again, or pick another model.'
      : "That didn't work. Try again.";
  }
}

/**
 * A message that used no Credits (refused before it started, or started and ended with nothing kept), in a chat that
 * still holds a warning that the message before it used Credits or may (chatLocal.js). What this one ended with comes
 * first. The warning follows, marked as the earlier one, so that "was not sent" or "No Credits were used" is not read
 * as "nothing can be charged". `stop_refunded` is said only here: on its own, Stop with nothing kept says nothing.
 */
export function chatUnchargedCopy(code, extra, warning) {
  return `${chatErrorCopy(code, extra)} Before that: ${chatErrorCopy(warning.code, warning)}`;
}

export { makeIdempotencyKey, lostNotice };

// The message's own request went out and no answer of ours came back: it failed on the way, the reply stream broke or
// ended with no event of ours in it, or what came back was neither ours nor a refusal. The server may hold the send
// all the same, so this is not "nothing was sent": the screen asks the server about the send by its key
// (useChatSend.js). Stop is the person's own doing and is passed on as it is, wherever in the request it lands.
const unanswered = (e, status = 0) => (e?.name === 'AbortError' ? e : new GatewayError('send_unanswered', { status, code: 'send_unanswered' }));

/**
 * Send one message and stream the reply. Calls onEvent(name, data) for start, delta, error, done.
 * Resolves { replay: true } when the same send already ran. Throws GatewayError for a refusal before the stream, and
 * with the code `send_unanswered` when the request went out and nothing of ours says what became of it (above).
 * Aborting `signal` is the Stop button.
 */
export async function sendTurn({ threadId, text, key, options, attachments = [], signal, onEvent }) {
  const token = await getFreshAccessToken();
  if (!token) {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('veyrnox:auth-required'));
    throw new GatewayError('not authenticated', { status: 401, code: 'no_token' });
  }
  let res;
  try {
    res = await fetch(`/api/v1/chat/threads/${encodeURIComponent(threadId)}/messages`, {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: json({
        text, idempotency_key: key, options: turnOptions(options),
        ...(attachments.length ? { attachments: attachments.map((a) => (typeof a === 'string' ? { source_key: a } : a)) } : {}),
      }),
    });
  } catch (e) {
    throw unanswered(e); // from here on the request may be at the server, whatever the browser saw of it
  }
  if (res.status === 401) {
    if (getSession()?.access_token === token) clearSession();
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('veyrnox:auth-required'));
    throw new GatewayError('unauthenticated', { status: 401, code: 'unauthenticated' });
  }
  if (!(res.headers.get('content-type') || '').includes('text/event-stream')) {
    let body = null;
    try { body = await res.json(); } catch (e) { if (e?.name === 'AbortError') throw e; /* otherwise: no body */ }
    if (res.ok && body?.replay) return { replay: true };
    // A refusal of ours names itself (`error`), and no reply runs after one. A 4xx that names nothing was made in front
    // of the turn (the edge, a proxy, the framework). Anything else says nothing about the turn: a Worker that failed
    // after the debit answers that way, with the turn still running.
    if (!body?.error && !(res.status >= 400 && res.status < 500)) throw unanswered(null, res.status);
    throw new GatewayError(body?.error || `HTTP ${res.status}`, { status: res.status, code: body?.error || 'gateway_error', body });
  }
  // A reply stream: the server answers with one only after the debit, and writes `start` first.
  let events = 0;
  try {
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
        try { const d = JSON.parse(data); events += 1; onEvent(event, d); } catch { /* a malformed frame is skipped, the stream goes on */ }
      }
    }
  } catch (e) {
    throw unanswered(e);
  }
  if (!events) throw unanswered(); // it ended with no event of ours in it: cut off before `start` could arrive
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
