import { fetchWithTimeout } from '../fetchWithTimeout.js';
import { rpc } from '../../packages/db/supabase-client.js';
import { decryptToken } from './tokenCrypto.js';
import { socialCustomerWebhooksEnabled } from './publishFeature.js';

const EVENTS = new Set(['post.published', 'post.delivered', 'post.failed']);
function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function generateSocialWebhookSecret() {
  return `vxwhsec_${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export function validateSocialWebhookUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let url; try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')
    || host === 'metadata.google.internal' || host.includes(':') || /^\d+(?:\.\d+){3}$/.test(host)
    || !host.includes('.')) return null;
  return url.toString();
}

export function normalizeSocialWebhookEvents(value) {
  if (!Array.isArray(value)) return null;
  const events = [...new Set(value)];
  return events.length >= 1 && events.length <= 3 && events.every((event) => EVENTS.has(event)) ? events : null;
}

export async function signSocialWebhook(secret, timestamp, body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function runSocialCustomerWebhookSweep({ cfg, cryptoCfg, env = process.env, fetcher = fetchWithTimeout, rpcCall = rpc, now = () => Date.now() }) {
  if (!socialCustomerWebhooksEnabled(env)) return { ok: true, skipped: 'disabled' };
  if (!cfg?.supabaseUrl || !cfg?.serviceRoleKey || !cryptoCfg) return { ok: false, skipped: 'not_configured' };
  const claimed = await rpcCall('claim_social_webhook_deliveries', { p_limit: 20 }, cfg);
  if (!claimed?.ok) return { ok: false, error: 'claim_failed' };
  const events = claimed.events || [];
  let delivered = 0, failed = 0;
  for (const event of events) {
    let success = false, status = null, error = null;
    try {
      const url = validateSocialWebhookUrl(event.url);
      if (!url) throw Object.assign(new Error('unsafe_destination'), { code: 'unsafe_destination' });
      const secret = await decryptToken(event.secret_enc, cryptoCfg);
      const body = JSON.stringify(event.payload);
      const timestamp = String(Math.floor(now() / 1000));
      const signature = await signSocialWebhook(secret, timestamp, body);
      const response = await fetcher(url, { method: 'POST', redirect: 'manual', headers: {
        'Content-Type': 'application/json', 'User-Agent': 'Veyrnox-Publish-Webhooks/1.0',
        'X-Veyrnox-Event': event.event_type, 'X-Veyrnox-Delivery': event.id,
        'X-Veyrnox-Timestamp': timestamp, 'X-Veyrnox-Signature': `v1=${signature}`,
      }, body }, 10_000, 64 * 1024);
      status = response.status; success = status >= 200 && status < 300;
      if (!success) error = `http_${status}`;
    } catch (caught) {
      error = caught?.name === 'AbortError' ? 'timeout' : caught?.code === 'unsafe_destination' ? 'unsafe_destination' : 'transport_error';
    }
    const completed = await rpcCall('complete_social_webhook_delivery', {
      p_event_id: event.id, p_claim_key: event.claim_key, p_success: success, p_status: status, p_error: error,
    }, cfg);
    if (success && completed?.ok) delivered += 1; else failed += 1;
  }
  return { ok: true, claimed: events.length, delivered, failed };
}
