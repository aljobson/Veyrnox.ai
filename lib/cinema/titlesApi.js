import { rpc, envConfig } from '../../packages/db/supabase-client.js';
import { cinemaFeatures } from './features.js';
import { CATEGORY_SLUG } from './domain.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_TTL_SECONDS = 60;
// Keep PostgreSQL's microseconds while accepting only unambiguous ISO instants.
function validCursorTime(value) {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}T[0-2]\d:[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value) || Number.isNaN(Date.parse(value))) return false;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value.slice(0, 10) && Number(value.slice(11, 13)) < 24;
}

async function cacheGet(key) { try { return await caches.default.match(key); } catch { return undefined; } }
async function cachePut(key, res) { try { await caches.default.put(key, res.clone()); } catch { /* not on Workers */ } }

/**
 * Public reads of published Cinema titles (ADR-0059). `action` is 'list' or
 * 'title'. The anonymous variant lives outside /api/v1, carries no identity
 * and is cached for a minute per URL; the signed-in variant under /api/v1
 * passes the verified identity so each episode reports what this viewer may
 * do with it, and it is never cached.
 */
export function titlesHandler({ action = 'list', authed = false, rpcCall = rpc, cache = { get: cacheGet, put: cachePut } } = {}) {
  return async (req, ctx) => {
    const requestId = crypto.randomUUID();
    const auth = authed ? req.headers.get('x-veyrnox-auth-id') : null;
    const reply = (body, status = 200, cacheable = false) => {
      console.info(JSON.stringify({ event: 'cinema.titles', request_id: requestId, actor_id: auth && UUID.test(auth) ? auth : undefined, action, status, code: body.error || 'ok' }));
      return Response.json({ ...body, request_id: requestId }, { status, headers: { 'Cache-Control': cacheable ? `public, max-age=${PUBLIC_TTL_SECONDS}` : 'no-store', 'x-request-id': requestId } });
    };
    if (authed && !UUID.test(auth || '')) return reply({ error: 'not_authenticated' }, 401);
    if (!cinemaFeatures(process.env).viewing) return reply({ error: 'viewing_not_open' }, 503);
    try {
      const url = new URL(req.url), query = url.searchParams;
      const cfg = envConfig();
      if (authed) {
        const rate = await rpcCall('consume_account_read_request', { p_auth_id: auth }, cfg);
        if (rate?.code === 'RATE_LIMITED') return reply({ error: 'rate_limited' }, 429);
        if (rate?.ok !== true) return reply({ error: 'temporarily_unavailable' }, 503);
      }
      if (action === 'list') {
        if ([...query.keys()].some((k) => !['before', 'before_id', 'limit', 'category'].includes(k))) return reply({ error: 'invalid_query' }, 400);
        const before = query.get('before');
        const beforeId = query.get('before_id');
        if ([...query.keys()].some(k => query.getAll(k).length !== 1) || (before === null) !== (beforeId === null) || (beforeId !== null && !UUID.test(beforeId))) return reply({ error: 'invalid_query' }, 400);
        const category = query.get('category');
        const limit = query.has('limit') ? Number(query.get('limit')) : 24;
        if ((before !== null && !validCursorTime(before)) || !Number.isInteger(limit) || limit < 1 || limit > 50
          || (category !== null && !CATEGORY_SLUG.test(category))) return reply({ error: 'invalid_query' }, 400);
        const cacheKey = !authed ? `https://veyrnox.ai/api/cinema/titles?limit=${limit}&before=${before ? encodeURIComponent(before) : ''}&category=${category || ''}&before_id=${beforeId || ''}` : null;
        if (cacheKey) { const hit = await cache.get(cacheKey); if (hit) return hit; }
        const [titles, categories] = await Promise.all([
          rpcCall('list_public_cinema_titles_page', { p_limit: limit, p_before: before, p_category: category, p_before_id: beforeId }, cfg),
          rpcCall('list_cinema_categories', {}, cfg),
        ]);
        if (!Array.isArray(titles) || !Array.isArray(categories)) return reply({ error: 'temporarily_unavailable' }, 503);
        const res = reply({ titles, categories, category, next: titles.length === limit ? titles[titles.length - 1].published_at : null, next_id: titles.length === limit ? titles[titles.length - 1].id : null }, 200, !authed);
        if (cacheKey) await cache.put(cacheKey, res);
        return res;
      }
      if (query.size) return reply({ error: 'invalid_query' }, 400);
      const params = ctx && ctx.params ? await ctx.params : {};
      const id = String(params.id || '').toLowerCase();
      if (!UUID.test(id)) return reply({ error: 'invalid_title' }, 400);
      const cacheKey = !authed ? `https://veyrnox.ai/api/cinema/titles/${id}` : null;
      if (cacheKey) { const hit = await cache.get(cacheKey); if (hit) return hit; }
      const title = await rpcCall('read_public_cinema_title', { p_auth_id: auth, p_content_id: id }, cfg);
      if (title?.error === 'title_not_found') return reply({ error: 'title_not_found' }, 404);
      if (!title || title.error || !UUID.test(title.id || '')) return reply({ error: 'temporarily_unavailable' }, 503);
      const res = reply({ title }, 200, !authed);
      if (cacheKey) await cache.put(cacheKey, res);
      return res;
    } catch { return reply({ error: 'temporarily_unavailable' }, 503); }
  };
}
