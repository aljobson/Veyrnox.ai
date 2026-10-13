import { readBoundedBody } from '../boundedBody.js';
import { rpc, envConfig } from '../../packages/db/supabase-client.js';
import { cinemaFeatures } from './features.js';
import { playbackConfig, signStreamPlayback, PLAYBACK_TTL_SECONDS, STREAM_UID } from './stream.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_POSTER_BYTES = 5 * 1024 * 1024;
const PUBLIC_TTL_SECONDS = 300;

async function cacheGet(key) { try { return await caches.default.match(key); } catch { return undefined; } }
async function cachePut(key, response) { try { await caches.default.put(key, response.clone()); } catch { /* unavailable outside Workers */ } }

export function posterTime(duration) {
  if (!Number.isFinite(duration) || duration < 0.1 || duration > 600) throw Error('invalid_duration');
  return Math.min(Math.max(duration * 0.25, 0.01), Math.max(duration - 0.01, 0.01));
}

export function streamPosterUrl(source, cfg, token) {
  if (!STREAM_UID.test(source?.stream_uid || '') || !Number.isFinite(Number(source?.duration_seconds))) throw Error('invalid_source');
  const url = new URL(`https://customer-${cfg.customerCode}.cloudflarestream.com/${token}/thumbnails/thumbnail.jpg`);
  url.searchParams.set('time', `${posterTime(Number(source.duration_seconds)).toFixed(3)}s`);
  url.searchParams.set('width', '1280');
  url.searchParams.set('height', '720');
  url.searchParams.set('fit', 'crop');
  return url;
}

export function posterHandler({ authed = false, rpcCall = rpc, sign = signStreamPlayback, fetcher = fetch,
  now = () => Date.now(), cache = { get: cacheGet, put: cachePut } } = {}) {
  return async (req, ctx) => {
    const requestId = crypto.randomUUID();
    const auth = authed ? req.headers.get('x-veyrnox-auth-id') : null;
    const fail = (error, status) => Response.json({ error, request_id: requestId }, {
      status, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId },
    });
    const flags = cinemaFeatures(process.env);
    if (authed ? !flags.uploads : !flags.viewing) return fail('posters_not_open', 503);
    if (authed && !UUID.test(auth || '')) return fail('not_authenticated', 401);
    const params = ctx?.params ? await ctx.params : {};
    const contentId = String(params.id || '').toLowerCase();
    if (!UUID.test(contentId) || new URL(req.url).searchParams.size) return fail('invalid_poster', 400);
    const cacheKey = authed ? null : `https://veyrnox.ai/api/cinema/posters/${contentId}`;
    if (cacheKey) { const hit = await cache.get(cacheKey); if (hit) return hit; }
    try {
      const cfg = playbackConfig();
      if (!cfg) return fail('posters_not_configured', 503);
      const db = envConfig();
      if (authed) {
        const rate = await rpcCall('consume_account_read_request', { p_auth_id: auth }, db);
        if (rate?.code === 'RATE_LIMITED') return fail('rate_limited', 429);
        if (rate?.ok !== true) return fail('temporarily_unavailable', 503);
      }
      const source = await rpcCall('read_cinema_poster_source', { p_auth_id: auth, p_content_id: contentId }, db);
      if (source?.error === 'poster_not_found') return fail('poster_not_found', 404);
      if (!STREAM_UID.test(source?.stream_uid || '')) return fail('temporarily_unavailable', 503);
      const expires = Math.floor(now() / 1000) + PLAYBACK_TTL_SECONDS;
      const token = await sign(source.stream_uid, cfg, expires);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'AbortError')), 10000);
      try {
        const upstream = await fetcher(streamPosterUrl(source, cfg, token), { redirect: 'manual', signal: controller.signal });
        const type = upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        if (upstream.status !== 200 || type !== 'image/jpeg') {
          if (upstream.body) await upstream.body.cancel();
          return fail('poster_unavailable', 503);
        }
        const bytes = await readBoundedBody(upstream.body, MAX_POSTER_BYTES, controller.signal);
        if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return fail('poster_unavailable', 503);
        const response = new Response(bytes, { status: 200, headers: {
          'Content-Type': 'image/jpeg', 'Content-Length': String(bytes.length),
          'Cache-Control': authed ? 'private, max-age=60' : `public, max-age=${PUBLIC_TTL_SECONDS}, stale-while-revalidate=3600`,
          'X-Content-Type-Options': 'nosniff', 'x-request-id': requestId,
        } });
        if (cacheKey) await cache.put(cacheKey, response);
        return response;
      } finally { clearTimeout(timer); }
    } catch {
      return fail('poster_unavailable', 503);
    }
  };
}
