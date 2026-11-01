/**
 * Active web Credit Packs for server-rendered public pages (the same rows as
 * GET /api/credit-packs: id, credits, price_usd_cents), cached 5 minutes in
 * the Workers Cache API. Never throws: structured data is an extra, so an
 * unreachable database yields [] and the page simply omits the price markup.
 */
import { select, envConfig } from '../packages/db/supabase-client.js';

const CACHE_KEY = 'https://veyrnox.ai/__internal/public-credit-packs/v1';
const CACHE_TTL_SECONDS = 300;

export async function readPublicCreditPacks() {
    try {
        const hit = await caches.default.match(CACHE_KEY);
        if (hit) return await hit.json();
    } catch { /* not on Workers */ }
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return [];
    try {
        const rows = await select(
            'credit_packs',
            { columns: 'id,credits,price_usd_cents', filter: 'sales_channel=eq.web&active=eq.true&order=credits.asc' },
            cfg,
        );
        const packs = (Array.isArray(rows) ? rows : []).map((r) => ({ id: r.id, credits: r.credits, price_usd_cents: r.price_usd_cents }));
        try {
            await caches.default.put(CACHE_KEY, new Response(JSON.stringify(packs), {
                headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_TTL_SECONDS}` },
            }));
        } catch { /* not on Workers */ }
        return packs;
    } catch (err) {
        console.error('[publicCreditPacks] select failed:', err && err.status);
        return [];
    }
}
