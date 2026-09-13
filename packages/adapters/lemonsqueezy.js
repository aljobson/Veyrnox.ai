/**
 * LemonSqueezy adapter — Merchant of Record for web Credit Packs (ADR-0018).
 *
 * Plain fetch against a constant API host, no SDK (the Workers bundle rule in
 * CLAUDE.md). The network function is injected so tests never touch it.
 *
 * Configuration (read from env at the route layer):
 *   LEMONSQUEEZY_API_KEY   Worker secret. Test-mode key makes test checkouts.
 *   LEMONSQUEEZY_STORE_ID  Worker var.
 *   PUBLIC_HOST            https origin the buyer returns to.
 */

const LEMONSQUEEZY_API_BASE = 'https://api.lemonsqueezy.com/v1';
const JSON_API = 'application/vnd.api+json';
const NUMERIC_ID_RE = /^[0-9]{1,20}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RETURN_PATH = '/app/credits';

/**
 * Create a hosted checkout for one pending Top-up.
 *
 * @param {object} input
 * @param {string} input.variantId  LemonSqueezy variant id, copied from the Top-up row
 * @param {string} input.topUpId    our top_ups.id; travels in checkout custom data
 * @param {string} [input.expiresAt] ISO timestamp after which the checkout link is dead
 * @param {object} cfg
 * @param {typeof fetch} cfg.fetch
 * @param {string} cfg.apiKey
 * @param {string} cfg.storeId
 * @param {string} cfg.publicHost
 * @param {number} [cfg.timeoutMs=10000]
 * @returns {Promise<{ok: true, url: string} | {ok: false, error: string}>}
 */
export async function createCheckout(input, cfg) {
    if (!NUMERIC_ID_RE.test(String(input.variantId))) return { ok: false, error: 'invalid variantId' };
    if (!UUID_RE.test(String(input.topUpId))) return { ok: false, error: 'invalid topUpId' };
    if (!NUMERIC_ID_RE.test(String(cfg.storeId))) return { ok: false, error: 'invalid storeId' };
    if (!cfg.apiKey) return { ok: false, error: 'missing apiKey' };

    let redirect;
    try { redirect = new URL(RETURN_PATH, cfg.publicHost); } catch { return { ok: false, error: 'invalid publicHost' }; }
    if (redirect.protocol !== 'https:') return { ok: false, error: 'publicHost must be https' };
    redirect.searchParams.set('top_up', input.topUpId);

    const body = {
        data: {
            type: 'checkouts',
            attributes: {
                product_options: {
                    redirect_url: redirect.toString(),
                    enabled_variants: [Number(input.variantId)],
                },
                checkout_data: { custom: { top_up_id: input.topUpId } },
                ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
            },
            relationships: {
                store: { data: { type: 'stores', id: String(cfg.storeId) } },
                variant: { data: { type: 'variants', id: String(input.variantId) } },
            },
        },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 10000);
    let res;
    try {
        res = await cfg.fetch(`${LEMONSQUEEZY_API_BASE}/checkouts`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                Accept: JSON_API,
                'Content-Type': JSON_API,
                Authorization: `Bearer ${cfg.apiKey}`,
            },
            body: JSON.stringify(body),
        });
    } catch (err) {
        return { ok: false, error: `transport: ${err && err.name}` };
    } finally {
        clearTimeout(timer);
    }

    // Vendor error bodies stay out of the result; the route logs status only.
    if (!res.ok) return { ok: false, error: `lemonsqueezy ${res.status}` };

    let data;
    try { data = await res.json(); } catch { return { ok: false, error: 'lemonsqueezy returned non-JSON' }; }
    const url = data && data.data && data.data.attributes && data.data.attributes.url;
    // The browser is sent here, so only a LemonSqueezy https URL is acceptable.
    let parsed;
    try { parsed = new URL(url); } catch { return { ok: false, error: 'checkout url missing' }; }
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.lemonsqueezy.com')) {
        return { ok: false, error: 'checkout url not on lemonsqueezy.com' };
    }
    return { ok: true, url: parsed.toString() };
}
