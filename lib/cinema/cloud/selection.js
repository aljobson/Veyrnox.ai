/** Server-side metadata verification for cloud import selections. No download URLs are accepted. */
import { readBoundedBody } from '../../boundedBody.js';
import { MAX_UPLOAD_BYTES } from '../uploadPolicy.js';

export const CLOUD_PROVIDERS = Object.freeze(['google_drive', 'dropbox', 'onedrive']);
const TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const ID = /^[A-Za-z0-9_!.-]{1,256}$/;
const fail = code => { throw new Error(code); };
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
function selection(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !CLOUD_PROVIDERS.includes(input.provider)
    || Object.keys(input).some(key => !['provider', 'file_id', 'drive_id'].includes(key))) fail('invalid_cloud_selection');
  if (typeof input.file_id !== 'string') fail('invalid_cloud_selection');
  if (input.provider === 'dropbox') {
    if (!/^id:[A-Za-z0-9_-]{1,256}$/.test(input.file_id || '') || input.drive_id !== undefined) fail('invalid_cloud_selection');
  } else if (!ID.test(input.file_id || '') || ['.', '..'].includes(input.file_id)) fail('invalid_cloud_selection');
  if (input.provider === 'onedrive') {
    if (typeof input.drive_id !== 'string' || !ID.test(input.drive_id || '') || ['.', '..'].includes(input.drive_id)) fail('invalid_cloud_selection');
  } else if (input.drive_id !== undefined) fail('invalid_cloud_selection');
}
function tokenHeaders(token) {
  if (!text(token, 8192) || /\s/.test(token)) fail('invalid_cloud_credential');
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
}
async function metadata(url, init, fetcher) {
  const signal = AbortSignal.timeout(10000);
  let response;
  try { response = await fetcher(url, { ...init, redirect: 'manual', signal }); }
  catch { fail('cloud_metadata_unavailable'); }
  if (!response.ok) {
    if (response.body) await response.body.cancel();
    fail(response.status === 401 || response.status === 403 ? 'cloud_access_denied' : 'cloud_metadata_unavailable');
  }
  try {
    const bytes = await readBoundedBody(response.body, 65536, signal);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { fail('cloud_metadata_invalid'); }
}
function normalize(input, file) {
  if (!text(file.name, 512) || !text(file.revision, 512)
    || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_UPLOAD_BYTES
    || !TYPES.has(file.mime_type)) fail('cloud_video_not_supported');
  return Object.freeze({ provider: input.provider, file_id: input.file_id,
    ...(input.drive_id ? { drive_id: input.drive_id } : {}),
    name: file.name, size: file.size, mime_type: file.mime_type, revision: file.revision });
}

/** Call only after authenticating the creator and verifying draft ownership.
 * Token must come from that creator's provider grant, never a shared service account.
 * Result is metadata only; it is not permission to create a Stream resource.
 */
export async function inspectCloudSelection(input, accessToken, fetcher = fetch) {
  selection(input);
  const headers = tokenHeaders(accessToken);
  if (input.provider === 'google_drive') {
    const fields = 'id,name,size,mimeType,version,trashed,capabilities(canDownload)';
    const row = await metadata(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.file_id)}?fields=${encodeURIComponent(fields)}`, { headers }, fetcher);
    if (row.id !== input.file_id || row.trashed !== false || row.capabilities?.canDownload !== true
      || typeof row.size !== 'string' || !/^[1-9][0-9]*$/.test(row.size)
      || typeof row.version !== 'string' || !/^[1-9][0-9]*$/.test(row.version)) fail('cloud_file_unavailable');
    return normalize(input, { name: row.name, size: Number(row.size), mime_type: row.mimeType, revision: row.version });
  }
  if (input.provider === 'dropbox') {
    const row = await metadata('https://api.dropboxapi.com/2/files/get_metadata', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: input.file_id, include_media_info: true }),
    }, fetcher);
    if (row['.tag'] !== 'file' || row.id !== input.file_id || !text(row.rev, 128)) fail('cloud_file_unavailable');
    // Dropbox has no MIME field here. Extension is an admission hint only;
    // Stream's authoritative processing must still validate the actual media.
    const extension = typeof row.name === 'string' ? row.name.split('.').at(-1).toLowerCase() : '';
    const mime = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' }[extension];
    return normalize(input, { name: row.name, size: row.size, mime_type: mime, revision: row.rev });
  }
  const fields = 'id,name,size,eTag,file,folder,deleted,remoteItem,parentReference';
  const row = await metadata(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(input.drive_id)}/items/${encodeURIComponent(input.file_id)}?$select=${encodeURIComponent(fields)}`, { headers }, fetcher);
  if (row.id !== input.file_id || row.parentReference?.driveId !== input.drive_id
    || !row.file || row.folder || row.deleted || row.remoteItem) fail('cloud_file_unavailable');
  return normalize(input, { name: row.name, size: row.size, mime_type: row.file.mimeType, revision: row.eTag });
}

/** Bind an import attempt to a verified source revision and a server-owned connection ID. */
export async function cloudSelectionFingerprint(file, connectionId) {
  selection({ provider: file?.provider, file_id: file?.file_id, ...(file?.drive_id ? { drive_id: file.drive_id } : {}) });
  normalize(file, file);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(connectionId || '')) fail('invalid_cloud_connection');
  const bytes = new TextEncoder().encode(JSON.stringify([connectionId.toLowerCase(), file.provider, file.drive_id || '', file.file_id, file.revision, file.size]));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
