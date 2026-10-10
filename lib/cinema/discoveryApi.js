import { rpc, envConfig } from '../../packages/db/supabase-client.js';
import { cinemaFeatures } from './features.js';
import { CATEGORY_SLUG } from './domain.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODES = ['all', 'series', 'voting'];
const TYPES = ['FILM', 'SHORT', 'TRAILER', 'SERIES', 'EPISODE'];
const instant = value => {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)) return false;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(Date.parse(value)) && date.toISOString().slice(0, 10) === value.slice(0, 10);
};
const text = (value, max) => typeof value === 'string' && value.length > 0 && [...value].length <= max;
const count = value => Number.isSafeInteger(value) && value >= 0;
const fields = ['mode', 'category', 'before', 'before_id', 'limit'];
// Anonymous, server-only public projection. Inbound identity headers are never read.
export function discoveryHandler({ rpcCall = rpc } = {}) {
  return async req => {
    const requestId = crypto.randomUUID();
    const reply = (body, status = 200) => Response.json({ ...body, request_id: requestId }, {
      status, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId },
    });
    const flags = cinemaFeatures(process.env);
    if (!flags.viewing) return reply({ error: 'viewing_not_open' }, 503);
    const q = new URL(req.url).searchParams;
    const mode = q.get('mode') || 'all', category = q.get('category');
    const before = q.get('before'), beforeId = q.get('before_id');
    const limit = q.has('limit') ? Number(q.get('limit')) : 12;
    if ([...q.keys()].some(k => !fields.includes(k) || q.getAll(k).length !== 1)
      || (q.has('mode') && !MODES.includes(q.get('mode'))) || !MODES.includes(mode)
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 24
      || (category !== null && !CATEGORY_SLUG.test(category))
      || (before === null) !== (beforeId === null)
      || (before !== null && (!instant(before) || !UUID.test(beforeId || '')))) return reply({ error: 'invalid_query' }, 400);
    if (mode === 'voting' && !flags.voting) return reply({ error: 'voting_not_open' }, 503);
    try {
      const cfg = envConfig();
      const [page, categories] = await Promise.all([
        rpcCall('list_cinema_discovery', { p_mode: mode, p_limit: limit, p_before: before, p_before_id: beforeId, p_category: category }, cfg),
        rpcCall('list_cinema_categories', {}, cfg),
      ]);
      if (!Array.isArray(page?.titles) || page.titles.length > limit || !Array.isArray(categories)
        || categories.length > 100 || categories.some(c => !CATEGORY_SLUG.test(c.slug || '') || !text(c.label, 80))
        || page.titles.some(t => !UUID.test(t.id || '') || !UUID.test(t.root_id || '') || !TYPES.includes(t.content_type)
          || (mode === 'series' && t.content_type !== 'SERIES') || !text(t.title, 160) || (typeof t.synopsis !== 'string' || [...t.synopsis].length > 2000)
          || !text(t.display_name, 80) || !text(t.username, 30) || !instant(t.published_at) || !count(t.episode_count)
          || (t.duration_seconds !== null && (!count(t.duration_seconds) || t.duration_seconds < 1))
          || (t.series_title !== null && !text(t.series_title, 160))
          || !Array.isArray(t.categories) || t.categories.length > 2 || t.categories.some(c => !CATEGORY_SLUG.test(c))
          || !Array.isArray(t.competitions) || t.competitions.length > 25 || (mode === 'voting' && !t.competitions.length)
          || t.competitions.some(c => !UUID.test(c.id || '') || !text(c.name, 80) || !instant(c.ends_at) || !count(c.qualified_votes)))) return reply({ error: 'temporarily_unavailable' }, 503);
      // Whitelist fields: even an unexpected RPC property cannot expose private data.
      const titles = page.titles.map(t => ({
        id: t.id, root_id: t.root_id, content_type: t.content_type, title: t.title, synopsis: t.synopsis,
        series_title: t.series_title, categories: t.categories, published_at: t.published_at,
        username: t.username, display_name: t.display_name, duration_seconds: t.duration_seconds, episode_count: t.episode_count,
        competitions: t.competitions.map(c => ({ id: c.id, name: c.name, ends_at: c.ends_at, qualified_votes: c.qualified_votes })),
      }));
      const last = titles.at(-1);
      return reply({ titles, categories: categories.map(c => ({ slug: c.slug, label: c.label })), mode,
        next: titles.length === limit ? { at: last.published_at, id: last.id } : null });
    } catch { return reply({ error: 'temporarily_unavailable' }, 503); }
  };
}
