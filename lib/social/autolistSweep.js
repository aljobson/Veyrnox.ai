import { fetchWithTimeout } from '../fetchWithTimeout.js';
import { rpc } from '../../packages/db/supabase-client.js';
import { socialRssAutolistsEnabled } from './publishFeature.js';
import { parseRssOrAtom, safeFeedUrl } from './rssFeed.js';

const ACCEPT = 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9';
const XML_TYPE = /(?:application|text)\/(?:rss\+xml|atom\+xml|xml)(?:;|$)/i;

function failureCode(err) {
  if (['unsafe_feed_url', 'unsafe_xml', 'unsupported_feed', 'empty_feed', 'feed_content_type', 'feed_http_error'].includes(err?.message)) return err.message;
  if (err?.name === 'AbortError') return 'feed_timeout';
  if (err?.status === 413 || err?.message === 'body_too_large') return 'feed_too_large';
  return 'feed_unavailable';
}

export async function runSocialAutolistSweep({ env = process.env, cfg, fetcher = fetchWithTimeout, rpcCall = rpc }) {
  if (!socialRssAutolistsEnabled(env)) return { ok: true, skipped: 'disabled' };
  if (!cfg?.supabaseUrl || !cfg?.serviceRoleKey) return { ok: false, skipped: 'not_configured' };
  let claim;
  try { claim = await rpcCall('claim_due_social_publish_autolists', { p_limit: 5 }, cfg); }
  catch { return { ok: false, error: 'claim_failed' }; }
  if (!claim?.ok) return { ok: false, error: 'claim_failed' };
  let refreshed = 0, scheduled = 0, failed = 0;
  for (const autolist of claim.autolists || []) {
    try {
      const url = safeFeedUrl(autolist.feed_url);
      if (!url) throw new Error('unsafe_feed_url');
      const headers = { Accept: ACCEPT, 'User-Agent': 'Veyrnox-Publish-Autolist/1.0' };
      if (autolist.etag) headers['If-None-Match'] = autolist.etag;
      if (autolist.last_modified) headers['If-Modified-Since'] = autolist.last_modified;
      const response = await fetcher(url, { method: 'GET', headers, redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer' }, 8000, 512 * 1024);
      if (response.status === 304) {
        const recorded = await rpcCall('record_social_publish_autolist_refresh', { p_id: autolist.id, p_items: [], p_etag: autolist.etag || null, p_last_modified: autolist.last_modified || null, p_not_modified: true }, cfg);
        if (!recorded?.ok) throw new Error('record_failed');
        refreshed += 1;
        continue;
      }
      if (!response.ok || (response.status >= 300 && response.status < 400)) throw new Error('feed_http_error');
      if (!XML_TYPE.test(response.headers.get('content-type') || '')) throw new Error('feed_content_type');
      const items = parseRssOrAtom(await response.text());
      const recorded = await rpcCall('record_social_publish_autolist_refresh', {
        p_id: autolist.id, p_items: items, p_etag: response.headers.get('etag'),
        p_last_modified: response.headers.get('last-modified'), p_not_modified: false,
      }, cfg);
      if (!recorded?.ok) throw new Error('record_failed');
      refreshed += 1;
      if (autolist.auto_schedule) {
        const queued = await rpcCall('schedule_social_publish_autolist_items', { p_id: autolist.id, p_limit: 10 }, cfg);
        if (!queued?.ok) throw new Error('schedule_failed');
        scheduled += Number(queued.scheduled) || 0;
      }
    } catch (err) {
      failed += 1;
      try { await rpcCall('fail_social_publish_autolist_refresh', { p_id: autolist.id, p_error: failureCode(err) }, cfg); } catch { /* next sweep retries */ }
    }
  }
  return { ok: true, claimed: (claim.autolists || []).length, refreshed, scheduled, failed };
}
