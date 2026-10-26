import { multiReferenceEnabled, MULTI_REFERENCE_CONTRACT } from './multiReference.mjs';
/**
 * The one public read of model_catalog (0028: a second path to the table is
 * how the next margin column leaks). GET /api/catalog, the landing page,
 * the /models pages and the sitemap all read through here.
 *
 * Active rows with a capability record only, as
 * { id, name, modality, credits, gated, durations, capabilities, updatedAt? }.
 * Never provider_cost_per_unit; provider and provider_endpoint are read to
 * derive durations, capabilities and the bestValue flag and are never returned.
 *
 * Throws when the catalog is unreachable; callers choose their fallback.
 */

import { editorFeatureEnabled } from './editorRuntimeFlags.mjs';
import { select, envConfig } from '../packages/db/supabase-client.js';
import { capabilityFor, lengthsFor, publicCapabilities } from './modelCapabilities.js';
import { requestWaitUntil } from './requestWaitUntil.js';

// Workers do not honour s-maxage for Worker-generated responses, so an
// unauthenticated flood would be one service-role PostgREST call each.
// The rows are kept in the Workers Cache API for 5 minutes.
const catalogCacheKey = (enabled = multiReferenceEnabled()) => `https://veyrnox.ai/__internal/public-catalog/v9/references-${MULTI_REFERENCE_CONTRACT}-${enabled ? 'on' : 'off'}/stems-${editorFeatureEnabled('EDITOR_AUDIO_STEMS_ENABLED') ? 'on' : 'off'}`;
export const CATALOG_TTL_SECONDS = 300;
// A copy older than the TTL is not served while the database answers, but it
// is kept this long so a Supabase outage (ADR-0160) still shows the price
// list instead of an error page.
export const CATALOG_STALE_SECONDS = 7 * 24 * 60 * 60;

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const WHOLESALE_NAME = /\s*\([^)]*\b(?:kie|fal|grsai|crun|byteplus|openrouter)\b[^)]*\)/gi;
const WHOLESALE_SUFFIX = /\s*(?:[·—-]|\bvia\b|\bthrough\b)\s*(?:kie|fal|grsai|crun|byteplus|openrouter)\b.*$/i;

/** Customer-facing names describe the model, never the wholesale route. */
export function publicModelName(value) {
    return String(value || '').replace(WHOLESALE_NAME, '').replace(WHOLESALE_SUFFIX, '').replace(/\s{2,}/g, ' ').trim();
}

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
            name: publicModelName(r.name),
            modality: r.modality,
            credits: r.credits_5s,
            // Our lowest-cost supply serves this model (ADR-0256). A flag only: the supplier is never named.
            bestValue: r.provider === 'crun',
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

export function normalizeCachedModels(models) {
    return models.map(model => ({ ...model, capabilities: model.capabilities ? {
        ...model.capabilities, media: Object.fromEntries(Object.entries(model.capabilities.media || {}).map(([slot, spec]) =>
            [slot, { ...spec, maxFiles: multiReferenceEnabled() ? Math.max(1, Math.min(3, spec.maxFiles || 1)) : 1 }]))
    } : model.capabilities }));
}

const COLUMNS = 'id,name,modality,credits_5s,gated_flag,provider,provider_endpoint,updated_at';
const FILTER = 'active=eq.true&modality=neq.text&order=modality.asc,name.asc'; // text rows are Chat (ADR-0067), listed by /api/v1/chat/models

async function fetchAndSave(cfg, selectRows, cacheKey) {
    const rows = await selectRows('model_catalog', { columns: COLUMNS, filter: FILTER }, cfg);
    const models = toPublicModels(rows);
    if (models.length > 0) await cachePut(models, cacheKey);
    return models;
}

// One background refresh per cache key per isolate, so a burst of visitors on
// a stale copy makes one PostgREST call, not one each.
const refreshing = new Map();

function refreshInBackground(cfg, selectRows, cacheKey, waitUntil) {
    if (refreshing.has(cacheKey)) return;
    const work = fetchAndSave(cfg, selectRows, cacheKey)
        .catch((err) => console.error('[publicCatalog] background refresh failed; the saved copy stays:', err && err.message))
        .finally(() => refreshing.delete(cacheKey));
    refreshing.set(cacheKey, work);
    waitUntil(work);
}

/** Tests only. */
export function _resetPublicCatalogRefresh() { refreshing.clear(); }

export async function readPublicCatalog({ cfg = envConfig(), selectRows = select, waitUntil = requestWaitUntil() } = {}) {
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) throw new Error('not_configured');
    const cacheKey = catalogCacheKey();
    const cached = await cacheGet(cacheKey);
    if (cached && cached.ageMs < CATALOG_TTL_SECONDS * 1000) return normalizeCachedModels(cached.models);
    // Stale-while-revalidate: past the window the visitor gets the saved copy
    // now and the refresh runs after the response. Where there is no Worker to
    // finish background work (next dev, tests) the read stays blocking.
    if (cached && waitUntil) {
        refreshInBackground(cfg, selectRows, cacheKey, waitUntil);
        return normalizeCachedModels(cached.models);
    }
    try {
        return await fetchAndSave(cfg, selectRows, cacheKey);
    } catch (err) {
        // Supabase is down: an old price list beats no price list.
        const fallback = cached || await cacheGet(catalogCacheKey(!multiReferenceEnabled()));
        if (fallback) {
            console.error('[publicCatalog] select failed; serving the saved copy:', err && err.message);
            return normalizeCachedModels(fallback.models);
        }
        throw err;
    }
}
