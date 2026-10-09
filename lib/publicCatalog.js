/**
 * The one public read of model_catalog (0028: a second path to the table is
 * how the next margin column leaks). GET /api/catalog, the landing page,
 * the /models pages and the sitemap all read through here.
 *
 * Active rows with a capability record only, as
 * { id, name, modality, credits, gated, durations, capabilities }.
 * Never provider_cost_per_unit; provider_endpoint is read to derive
 * durations and capabilities and is never returned.
 *
 * Throws when the catalog is unreachable; callers choose their fallback.
 */

import { select, envConfig } from '../packages/db/supabase-client.js';
import { capabilityFor, lengthsFor, publicCapabilities } from './modelCapabilities.js';

// Workers do not honour s-maxage for Worker-generated responses, so an
// unauthenticated flood would be one service-role PostgREST call each.
// The rows are kept in the Workers Cache API for 5 minutes.
const CACHE_KEY = 'https://veyrnox.ai/__internal/public-catalog';
export const CATALOG_TTL_SECONDS = 300;

async function cacheGet() {
    try {
        const hit = await caches.default.match(CACHE_KEY);
        return hit ? await hit.json() : undefined;
    } catch { return undefined; }
}
async function cachePut(models) {
    try {
        await caches.default.put(CACHE_KEY, new Response(JSON.stringify(models), {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CATALOG_TTL_SECONDS}` },
        }));
    } catch { /* not on Workers */ }
}

export function toPublicModels(rows) {
    const models = [];
    for (const r of Array.isArray(rows) ? rows : []) {
        // The gateway refuses a model with no capability record, so listing
        // one would sell something that cannot be bought.
        const record = capabilityFor(r.provider_endpoint);
        if (!record) {
            console.error('[publicCatalog] active row has no capability record:', r.id);
            continue;
        }
        models.push({
            id: r.id,
            name: r.name,
            modality: r.modality,
            credits: r.credits_5s,
            gated: !!r.gated_flag,
            // Clip lengths this model may be bought at. The create page renders
            // exactly these, so it can never offer a length the gateway rejects.
            durations: lengthsFor(record),
            // Which controls apply: inputs, enum values, reference slots. No
            // provider field names, pins or costs (ADR-0027).
            capabilities: publicCapabilities(record),
        });
    }
    return models;
}

export async function readPublicCatalog({ cfg = envConfig(), selectRows = select } = {}) {
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) throw new Error('not_configured');
    const cached = await cacheGet();
    if (cached) return cached;
    const rows = await selectRows(
        'model_catalog',
        { columns: 'id,name,modality,credits_5s,gated_flag,provider_endpoint', filter: 'active=eq.true&modality=neq.text&order=modality.asc,name.asc' }, // text rows are Chat (ADR-0067), listed by /api/v1/chat/models
        cfg,
    );
    const models = toPublicModels(rows);
    if (models.length > 0) await cachePut(models);
    return models;
}
