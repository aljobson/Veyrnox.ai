import { gatewayFetch } from '../../gateway.js';
import { getSession } from '../../../../lib/authClient.js';
import { mixdownSources } from './beatMixdownSources.mjs';
export const MIXDOWN_LIMIT_MESSAGE = 'This mix is too long to save to Music (over 25 MB). Export a shorter cycle range or download the WAV instead.';
export const SAVE_OFFLINE_MESSAGE = 'Saving to Music needs a connection. You can still download the WAV.';
export function mixdownSaveError(error) {
  if (error.status === 401) return 'Sign in again to save to Music; your project is saved on this device.';
  if (error.code === 'network_error' || globalThis.navigator?.onLine === false) return SAVE_OFFLINE_MESSAGE;
  return ({ mixdown_size_invalid: MIXDOWN_LIMIT_MESSAGE, source_unavailable: 'A song used in this mix is no longer available. Restore it in Music, or download the WAV.',
    account_frozen: 'Your account is paused. You can still download this mix.',
    rights_confirmation_required: 'Confirm that you have permission to use this audio.',
    reservation_closed: 'This save expired. Try again to start a new save.', reservation_expired: 'This save expired. Try again to start a new save.',
    idempotency_conflict: 'This save changed. Try again to start a new save.',
    rate_limited: 'Too many saves just now. Wait a minute and try again.' })[error.code]
    || 'Music is having trouble right now. Your mix is safe — try again or download it.';
}
export async function wavSha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
function upload(url, headers, bytes, signal, progress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(), abort = () => xhr.abort();
    const finish = (error) => { signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
    xhr.open('PUT', url); xhr.withCredentials = false;
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = e => { if (e.lengthComputable) progress(`Uploading ${Math.round(e.loaded / e.total * 100)}%…`); };
    xhr.onload = () => finish((xhr.status >= 200 && xhr.status < 300) || xhr.status === 412 ? null : new Error('Upload failed'));
    xhr.onerror = () => finish(Object.assign(new Error('Upload failed'), { code: 'network_error' }));
    xhr.onabort = () => finish(new DOMException('Aborted', 'AbortError'));
    signal?.throwIfAborted(); signal?.addEventListener('abort', abort, { once: true }); xhr.send(bytes);
  });
}
export async function saveMixdownToLibrary({ doc, range = 'song', wavBytes, rightsConfirmed, idempotencyKey, signal, progress = () => {} }) {
  if (wavBytes.byteLength > 26_214_400) throw Object.assign(new Error(MIXDOWN_LIMIT_MESSAGE), { code: 'mixdown_size_invalid' });
  if (globalThis.navigator?.onLine === false) throw Object.assign(new Error(SAVE_OFFLINE_MESSAGE), { code: 'network_error' });
  const { songs, hasTakes } = mixdownSources(doc, { range });
  const account = getSession()?.user?.id;
  const checkAccount = () => { if (!account || getSession()?.user?.id !== account) throw Object.assign(new Error('Session changed'), { status: 401 }); };
  checkAccount();
  const post = body => { checkAccount(); return gatewayFetch('/music/mixdowns', { method: 'POST', body: JSON.stringify(body), signal }); };
  progress('Preparing your save…');
  const result = await post({ action: 'reserve', idempotency_key: idempotencyKey, title: doc.title,
    size_bytes: wavBytes.byteLength, sha256: await wavSha256(wavBytes), duration_seconds: (wavBytes.byteLength - 44) / (48000 * 4),
    sources: songs, has_takes: hasTakes, rights_confirmed: hasTakes && rightsConfirmed === true });
  checkAccount();
  if (result.committed) return result;
  await upload(result.upload_url, result.headers, wavBytes, signal, progress);
  checkAccount(); progress('Adding to your library…');
  return post({ action: 'commit', idempotency_key: idempotencyKey, version_id: result.version_id });
}
