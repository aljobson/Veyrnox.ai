import { protectedRoute } from '../packages/security/route.js';
import { ApiError } from '../packages/security/errors.js';
import { exactKeys, readJson, uuid } from '../packages/security/input.js';
import { tenantRequest } from '../packages/db/tenant-client.js';
import { musicBeatCloudEnabled } from './musicBackend.js';
export { ApiError, uuid };
export const BEAT_READ_BYTES = 600000;
export const PROJECT_FIELDS = 'id,beat_id,title,doc_version,revision,created_at,updated_at';
export const VERSION_FIELDS = 'id,revision,title,reason,saved_at';
export const fail = (status, code) => { throw new ApiError(status, code, 'The beat account request could not be completed.'); };
export function beatRoute(request, action) {
  return protectedRoute(request, context => {
    if (!musicBeatCloudEnabled()) fail(404, 'NOT_FOUND');
    return action(context);
  });
}
export const tenant = (request, context, path, options = {}) => tenantRequest(request, context, path, { limitAware: true, beatAware: true, ...options });
export const rpc = (request, context, name, body) => tenant(request, context, `rpc/${name}`, { method: 'POST', body });
export async function bodyOf(request, keys, max = BEAT_READ_BYTES) {
  const body = await readJson(request, max); exactKeys(body, keys);
  if (keys.some(key => !Object.hasOwn(body, key))) fail(400, 'INVALID_REQUEST');
  return body;
}
export function revision(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > 2147483647) fail(400, 'INVALID_REVISION');
  return value;
}
export async function projectRow(request, context, beatId, document = false) {
  const rows = await tenant(request, context, `music_beat_projects?select=${PROJECT_FIELDS}${document ? ',doc_json' : ''}&beat_id=eq.${encodeURIComponent(beatId)}&limit=1`, { maxBytes: BEAT_READ_BYTES });
  if (!rows[0]) fail(404, 'NOT_FOUND');
  return rows[0];
}
