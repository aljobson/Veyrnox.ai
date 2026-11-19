import { assertBeatWritable, unsupportedBeatVersion, beatCompatibilityError } from './beatCompatibility.mjs';
import { migrateBeat, validateBeat } from './beatDocument.mjs';
export function parseCloudBeat(json, beatId) {
  const doc = JSON.parse(json);
  if (unsupportedBeatVersion(doc?.version)) throw beatCompatibilityError('unsupported_version');
  if (!validateBeat(doc).ok || doc.id !== beatId) throw new Error('Invalid account beat');
  return migrateBeat(doc);
}
export function classifyCloudBeat(json, beatId) {
  try { parseCloudBeat(json, beatId); return 'ok'; }
  catch (error) { return error.code === 'unsupported_version' ? 'unsupported-version' : 'damaged'; }
}
export const errorCode = error => String(error?.code || '').toUpperCase();
export const sameAccount = (captured, current) => Boolean(captured?.userId && captured.userId === current?.userId && captured.generation === current.generation);
export const removedLink = userId => ({ userId, projectId: null, revision: 0 });
export const isRemoved = link => Boolean(link && link.projectId === null && !Object.hasOwn(link, 'syncedUpdatedAt'));
export const maySync = (link, userId) => Boolean(userId && link?.userId === userId && !isRemoved(link));
// Local revisions also detect edits made in the same millisecond or after a clock rollback.
export const needsSync = (record, userId, syncedLocalRevision = record?.revision) => maySync(record?.cloud, userId) &&
  (!record.cloud.projectId || record.cloud.syncedUpdatedAt !== record.doc.updatedAt || (syncedLocalRevision != null && syncedLocalRevision !== record.revision));
export function errorState(error) {
  const code = errorCode(error);
  if (['BEAT_WRITES_DISABLED', 'V5_WRITE_DISABLED'].includes(code)) return 'read_only';
  if (['BEAT_CLIENT_OUTDATED', 'UNSUPPORTED_VERSION'].includes(code)) return 'update_required';
  if (code === 'NOT_FOUND') return 'removed';
  if (code === 'VERSION_CONFLICT') return 'conflict';
  if (code === 'LIMIT_REACHED') return 'limit';
  if (code === 'RATE_LIMITED') return 'rate_limited';
  return !error?.status || code === 'NETWORK_ERROR' ? 'offline' : 'error';
}
export const retryDelay = (attempt, error) => ['limit', 'removed', 'update_required', 'read_only'].includes(errorState(error)) ? null : errorState(error) === 'rate_limited' ? 60000 : Math.min(300000, 10000 * 2 ** Math.min(attempt, 5));
export const takeAssets = doc => [...new Map(Object.values(doc?.assets || {}).filter(a => a.source === 'take').map(a => [a.ref, a])).values()];
export const takesToUpload = (doc, rows, refused = new Set()) => takeAssets(doc).filter(a => !refused.has(a.ref) && !rows.some(r => r.take_ref === a.ref && r.status === 'ready'));
export const conflictRequest = (choice, doc, revision) => saveRequest(doc, revision, choice === 'mine' ? 'checkpoint' : 'stash');
export function saveRequest(doc, revision, mode = 'autosave') {
  assertBeatWritable(doc);
  return { expected_revision: revision, doc_json: JSON.stringify(doc), mode };
}
// The latest document is captured after the finalizer and any in-flight local save.
// Callers hold their local write/edit barrier for this entire sequence.
export async function replaceAfterStash({ latest, media, stash, replace, current }) {
  const captured = await latest();
  await media?.(captured.doc);
  await stash?.(captured.doc);
  if (!current(captured)) throw Object.assign(new Error('Local beat changed'), { code: 'LOCAL_CONFLICT' });
  const result = await replace(captured);
  if (result?.error) throw Object.assign(new Error('Local beat changed'), { code: 'LOCAL_CONFLICT' });
  return result;
}
export async function recoverTake({ row, confirm, reserve, put }) {
  if (row?.status === 'ready') return row;
  if (row?.status === 'pending') {
    try { await confirm(row.id); return { ...row, status: 'ready' }; }
    catch (error) { if (errorCode(error) !== 'TAKE_UPLOAD_MISSING') throw error; }
  }
  const reserved = await reserve();
  // A body that failed mid-read comes back empty from the gateway: treat any unusable
  // reservation as a transient network failure, never as a permanent refusal.
  if (!reserved || typeof reserved.take_id !== 'string' || !['ready', 'pending'].includes(reserved.status) ||
    (reserved.status === 'pending' && typeof reserved.upload_url !== 'string'))
    throw Object.assign(new Error('Network error'), { code: 'NETWORK_ERROR' });
  if (reserved.status === 'ready') return { id: reserved.take_id, status: 'ready' };
  const response = await put(reserved);
  if (!response.ok && response.status !== 412) throw Object.assign(new Error('Take upload failed'), { status: response.status, code: 'TAKE_UPLOAD_FAILED' });
  await confirm(reserved.take_id);
  return { id: reserved.take_id, status: 'ready' };
}
export const syncDocumentThenMedia = async (save, media) => { const project = await save(); await media(); return project; };

export const COPY_TAKES_MESSAGE = "This beat uses takes that are only in your account, so it can't be copied on this device yet.";
export async function createDeviceCopy(doc, shelf, create, id, now) {
  try { assertBeatWritable(doc); } catch (error) { return { error: error.code }; }
  if (takeAssets(doc).some(asset => !shelf.some(take => take.id === asset.ref))) return { error: 'cloud_only_takes' };
  const copy = { ...structuredClone(doc), id, title: `${doc.title.slice(0, 73)} (copy)`, createdAt: now, updatedAt: now };
  const result = await create(copy);
  return result.error ? result : { ...result, id };
}
