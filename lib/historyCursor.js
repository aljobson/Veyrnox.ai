const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

/** Strict keyset cursor, retaining database microseconds and equal-time UUID ties. */
export function historyCursor(url) {
    const query = new URL(url).searchParams;
    const before = query.get('before'), id = query.get('before_id');
    if (before === null && id === null) return '';
    if (!before || !id || !ISO.test(before) || !Number.isFinite(Date.parse(before)) || !UUID.test(id)) {
        throw new Error('invalid_cursor');
    }
    return `&or=${encodeURIComponent(`(created_at.lt.${before},and(created_at.eq.${before},id.lt.${id}))`)}`;
}
export function historyPage(rows, limit) {
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return { items, next: rows.length > limit ? { before: last.created_at, before_id: last.id } : null };
}
