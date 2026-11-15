import { validateBeat } from './beatDocument.mjs';
export function validRecord(record) {
  return Boolean(record && Number.isSafeInteger(record.revision) && record.revision > 0 && validateBeat(record.doc).ok && record.id === record.doc.id && record.updatedAt === record.doc.updatedAt);
}
export function decideCreate(existing) { return existing ? { error: 'conflict' } : { action: 'put' }; }
export function decideUpdate(existing, doc, expectedRevision) {
  if (!validateBeat(doc).ok) return { error: 'invalid' };
  if (!existing) return { error: 'not_found' };
  if (!validRecord(existing) || existing.id !== doc.id) return { error: 'invalid' };
  if (existing.revision !== expectedRevision) return { error: 'conflict' };
  return { action: 'put', record: { id: doc.id, revision: existing.revision + 1, doc, updatedAt: doc.updatedAt } };
}
export function decideDelete(existing, expectedRevision) {
  if (!existing) return { error: 'not_found' };
  if (expectedRevision !== undefined && existing.revision !== expectedRevision) return { error: 'conflict' };
  return { action: 'delete' };
}
