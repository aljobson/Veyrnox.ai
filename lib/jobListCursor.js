const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

// Preserve database microseconds: Date#toISOString would truncate them and
// skip jobs at a page boundary. Z also survives a decoded query being parsed
// a second time, where an encoded UTC '+' can otherwise become a space.
export function jobCursorTimestamp(value) {
  if (typeof value !== 'string') throw new Error('invalid_cursor');
  const timestamp = value.replace(/[+ ]00:00$/, 'Z');
  if (!ISO.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) throw new Error('invalid_cursor');
  return timestamp;
}

export function jobsPagePath(cursor, limit = 24) {
  if (!cursor || !UUID.test(cursor.before_id)) throw new Error('invalid_cursor');
  const before = jobCursorTimestamp(cursor.before);
  return `/jobs?${new URLSearchParams({ limit: String(limit), before, before_id: cursor.before_id })}`;
}
