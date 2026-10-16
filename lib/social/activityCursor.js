const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCES = new Set(['publish', 'team', 'inbox', 'approval']);
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_LENGTH = 256;

function checkedCursor(value, legacy = false) {
  // Older clients sent JSON directly in the query. OpenNext reconstructs that
  // decoded query without escaping '+', so the second parse sees one space in
  // place of a positive UTC-offset sign. Repair only that exact legacy shape.
  const createdAt = legacy && typeof value?.created_at === 'string'
    ? value.created_at.replace(/ (\d{2}:\d{2})$/, '+$1') : value?.created_at;
  if (typeof value?.id !== 'string' || !UUID.test(value.id) || !SOURCES.has(value?.source)
    || typeof createdAt !== 'string' || !TIMESTAMP.test(createdAt)
    || !Number.isFinite(Date.parse(createdAt))) throw new Error('invalid cursor');
  return { created_at: createdAt, id: value.id, source: value.source };
}

export function encodeActivityCursor(value) {
  const cursor = checkedCursor(value);
  // Cursor fields are validated ASCII. Base64url survives the adapter's query
  // reconstruction while retaining PostgreSQL's full microsecond precision.
  return btoa(JSON.stringify(cursor)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeActivityCursor(value) {
  try {
    if (typeof value !== 'string' || !value || value.length > MAX_LENGTH) throw new Error('invalid cursor');
    const legacy = value.startsWith('{');
    if (!legacy && !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid cursor');
    const json = legacy ? value : atob(value.replaceAll('-', '+').replaceAll('_', '/'));
    if (json.length > MAX_LENGTH) throw new Error('invalid cursor');
    return checkedCursor(JSON.parse(json), legacy);
  } catch { throw new Error('invalid cursor'); }
}
