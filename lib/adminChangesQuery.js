export const CHANGE_AREAS = Object.freeze(['account', 'role', 'switch', 'plan', 'support', 'other']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/;
function timestamp(value) {
  return TIMESTAMP.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}

/** Keep PostgreSQL's microseconds in cursors; a JS Date would lose them. */
export function changesQuery(params) {
  const allowed = new Set(['area', 'actor', 'from', 'to', 'before', 'limit']);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) return { error: 'filters_invalid' };
  }
  const area = params.get('area');
  const actor = params.get('actor');
  const from = params.get('from');
  const to = params.get('to');
  const rawLimit = params.get('limit') ?? '50';
  if ((area !== null && !CHANGE_AREAS.includes(area))
    || (actor !== null && (actor.trim().length < 1 || actor.length > 320 || /[\x00-\x1f\x7f]/.test(actor)))
    || (from !== null && !timestamp(from)) || (to !== null && !timestamp(to))
    || (from !== null && to !== null && Date.parse(from) >= Date.parse(to))
    || !/^[1-9]\d{0,2}$/.test(rawLimit) || Number(rawLimit) > 100) return { error: 'filters_invalid' };
  let before = null;
  if (params.has('before')) {
    const raw = params.get('before');
    if (raw.length > 200) return { error: 'cursor_invalid' };
    try { before = JSON.parse(raw); } catch { return { error: 'cursor_invalid' }; }
    if (!before || typeof before !== 'object' || Array.isArray(before)
      || Object.keys(before).sort().join(',') !== 'created_at,id'
      || typeof before.id !== 'string' || !UUID.test(before.id)
      || typeof before.created_at !== 'string' || !timestamp(before.created_at)) return { error: 'cursor_invalid' };
  }
  return { args: { p_area: area, p_actor: actor?.trim() ?? null, p_from: from, p_to: to, p_before: before, p_limit: Number(rawLimit) } };
}
