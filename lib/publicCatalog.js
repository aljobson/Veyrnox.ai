/**
 * The one public read of model_catalog (0028: a second path to the table is
 * how the next margin column leaks). GET /api/catalog, the landing page,
 * the /models pages and the sitemap all read through here.
 *
 * Active rows with a capability record only, as
 * { id, name, modality, credits, gated, durations, capabilities, updatedAt? }.
 * Never provider_cost_per_unit; provider_endpoint is read to derive
 * durations and capabilities and is never returned.
 *
 * Throws when the catalog is unreachable; callers choose their fallback.
 */

import { editorFeatureEnabled } from './editorRuntimeFlags.mjs';
import { select, envConfig } from '../packages/db/supabase-client.js';
import { capabilityFor, lengthsFor, publicCapabilities } from './modelCapabilities.js';

// Workers do not honour s-maxage for Worker-generated responses, so an
// unauthenticated flood would be one service-role PostgREST call each.
// The rows are kept in the Workers Cache API for 5 minutes.
const catalogCacheKey = () => `https://veyrnox.ai/__internal/public-catalog/v6/stems-${editorFeatureEnabled('EDITOR_AUDIO_STEMS_ENABLED') ? 'on' : 'off'}`;
export const CATALOG_TTL_SECONDS = 300;
// A copy older than the TTL is not served while the database answers, but it
// is kept this long so a Supabase outage (ADR-0160) still shows the price
// list instead of an error page.
export const CATALOG_STALE_SECONDS = 7 * 24 * 60 * 60;

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function validatedUpdatedAt(value) {
    if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value)) return undefined;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

// { models, ageMs } for the saved copy, or undefined. A copy with no
// timestamp (written before the stale window existed) counts as fresh: it
// expires on its own old max-age.
async function cacheGet(key) {
    try {
        const hit = await caches.default.match(key);
        if (!hit) return undefined;
        const fetchedAt = Number(hit.headers.get('X-Fetched-At'));
        return { models: await hit.json(), ageMs: Number.isFinite(fetchedAt) && fetchedAt > 0 ? Math.max(0, Date.now() - fetchedAt) : 0 };
    } catch { return undefined; }
}
async function cachePut(models, key) {
    try {
        await caches.default.put(key, new Response(JSON.stringify(models), {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CATALOG_STALE_SECONDS}`, 'X-Fetched-At': String(Date.now()) },
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
        const updatedAt = validatedUpdatedAt(r.updated_at);
        models.push({
            id: r.id,
            name: r.name,
            modality: r.modality,
            credits: r.credits_5s,
            gated: !!r.gated_flag || (!!record.outputStems && !editorFeatureEnabled('EDITOR_AUDIO_STEMS_ENABLED')),
            // Clip lengths this model may be bought at. The create page renders
            // exactly these, so it can never offer a length the gateway rejects.
            durations: lengthsFor(record),
            // Which controls apply: inputs, enum values, reference slots. No
            // provider field names, pins or costs (ADR-0027).
            capabilities: publicCapabilities(record),
            ...(updatedAt ? { updatedAt } : {}),
        });
    }
    return models;
}

export async function readPublicCatalog({ cfg = envConfig(), selectRows = select } = {}) {
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) throw new Error('not_configured');
    const cacheKey = catalogCacheKey();
    const cached = await cacheGet(cacheKey);
    if (cached && cached.ageMs < CATALOG_TTL_SECONDS * 1000) return cached.models;
    let rows;
    try {
        rows = await selectRows(
            'model_catalog',
            { columns: 'id,name,modality,credits_5s,gated_flag,provider_endpoint,updated_at', filter: 'active=eq.true&modality=neq.text&order=modality.asc,name.asc' }, // text rows are Chat (ADR-0067), listed by /api/v1/chat/models
            cfg,
        );
    } catch (err) {
        // Supabase is down: an old price list beats no price list.
        if (cached) {
            console.error('[publicCatalog] select failed; serving the saved copy:', err && err.message);
            return cached.models;
        }
        throw err;
    }
    const models = toPublicModels(rows);
    if (models.length > 0) await cachePut(models, cacheKey);
    return models;
}
