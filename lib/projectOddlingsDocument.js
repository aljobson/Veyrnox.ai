import { validProjectDocument } from './projectDocument.js';

export const ODDLINGS_SCHEMA_VERSION = 4;
export const isOddlingsDocument = doc => doc?.schema_version === ODDLINGS_SCHEMA_VERSION;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => object(value) && Object.keys(value).length === expected.length
  && expected.every(key => Object.hasOwn(value, key));
const text = (value, min, max) => typeof value === 'string' && value.length >= min && value.length <= max;
const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 1e14;
const safeStrings = value => typeof value === 'string' ? value.isWellFormed() && !/[\u0000-\u001f]/u.test(value)
  : value !== null && typeof value === 'object' ? Object.entries(value).every(([key, child]) => safeStrings(key) && safeStrings(child)) : true;
const picks = value => object(value) && Object.keys(value).length <= 64
  && Object.entries(value).every(([key, pick]) => /^[a-z_]{1,40}$/.test(key) && text(pick, 1, 160));
const item = value => keys(value, ['id', 'savedAt', 'name', 'picks', 'motionId'])
  && typeof value.id === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(value.id)
  && timestamp(value.savedAt) && text(value.name, 1, 40) && picks(value.picks)
  && typeof value.motionId === 'string' && /^[a-z0-9-]{0,40}$/.test(value.motionId);

/** Stored jsonb text size for well-formed JSON with integer numbers, including PostgreSQL's separator spaces. */
export function jsonbTextBytes(value) {
  const spaces = v => v !== null && typeof v === 'object'
    ? (Array.isArray(v) ? 0 : Object.keys(v).length) + Math.max(0, Object.keys(v).length - 1)
      + Object.values(v).reduce((sum, child) => sum + spaces(child), 0) : 0;
  return new TextEncoder().encode(JSON.stringify(value)).byteLength + spaces(value);
}

export function validOddlingsProjectDocument(value, projectId) {
  if (!keys(value, ['schema_version', 'project_id', 'brief', 'canvas', 'oddlings']) || !isOddlingsDocument(value)) return false;
  const collection = value.oddlings;
  return validProjectDocument({ schema_version: 1, project_id: value.project_id, brief: value.brief, canvas: value.canvas }, projectId)
    && keys(collection, ['version', 'items', 'draft']) && collection.version === 1
    && Array.isArray(collection.items) && collection.items.length <= 24 && collection.items.every(item)
    && new Set(collection.items.map(entry => entry.id)).size === collection.items.length
    && (collection.draft === null || (keys(collection.draft, ['savedAt', 'picks'])
      && timestamp(collection.draft.savedAt) && picks(collection.draft.picks)))
    && safeStrings(value) && jsonbTextBytes(value) <= 32768;
}
