import { assertBeatWritable, unsupportedBeatVersion } from './beatCompatibility.mjs';
import { validateBeat, validBeatId } from './beatDocument.mjs';
export function validCloudLink(link) {
  return Boolean(link && (Object.keys(link).sort().join(',') === 'projectId,revision,syncedUpdatedAt,userId' ||
    (link.projectId === null && Object.keys(link).sort().join(',') === 'projectId,revision,userId')) &&
    validBeatId(link.userId) && (link.projectId === null ? link.revision === 0 : validBeatId(link.projectId) && Number.isSafeInteger(link.revision) && link.revision > 0) &&
    (!Object.hasOwn(link, 'syncedUpdatedAt') || (Number.isSafeInteger(link.syncedUpdatedAt) && link.syncedUpdatedAt >= 0)));
}
export function decideCloudLink(existing, captured, link) {
  if (unsupportedBeatVersion(existing?.doc?.version)) return { error: 'unsupported_version' };
  try { assertBeatWritable(existing?.doc); } catch (error) { return { error: error.code }; }
  if (!existing || !validRecord(existing) || !validCloudLink(link)) return { error: 'invalid' };
  if (existing.cloud ? existing.cloud.userId !== captured?.userId : captured?.userId != null) return { error: 'conflict' };
  return { action: 'put', record: { ...existing, cloud: link } };
}
export function classifyRecord(record) {
  if (unsupportedBeatVersion(record?.doc?.version)) return 'unsupported-version';
  return validRecord(record) ? 'ok' : 'damaged';
}
export function validRecord(record) {
  return Boolean(record && (!Object.hasOwn(record, 'cloud') || validCloudLink(record.cloud)) && Number.isSafeInteger(record.revision) && record.revision > 0 && validateBeat(record.doc).ok && record.id === record.doc.id && record.updatedAt === record.doc.updatedAt);
}
export function decideCreate(existing) { return existing ? { error: 'conflict' } : { action: 'put' }; }
export function decideUpdate(existing, doc, expectedRevision) {
  if (unsupportedBeatVersion(existing?.doc?.version)) return { error: 'unsupported_version' };
  try { assertBeatWritable(doc); assertBeatWritable(existing?.doc); } catch (error) { return { error: error.code }; }
  if (!validateBeat(doc).ok) return { error: 'invalid' };
  if (!existing) return { error: 'not_found' };
  if (!validRecord(existing) || existing.id !== doc.id) return { error: 'invalid' };
  if (existing.revision !== expectedRevision) return { error: 'conflict' };
  return { action: 'put', record: { id: doc.id, revision: existing.revision + 1, ...(existing.cloud ? { cloud: existing.cloud } : {}), doc, updatedAt: doc.updatedAt } };
}
export function decideDelete(existing, expectedRevision) {
  if (unsupportedBeatVersion(existing?.doc?.version)) return { error: 'unsupported_version' };
  if (!existing) return { error: 'not_found' };
  if (expectedRevision !== undefined && existing.revision !== expectedRevision) return { error: 'conflict' };
  return { action: 'delete' };
}
