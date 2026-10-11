import { resolveUploadedSource, resolveAssetSource } from './resolveSource.js';
import { generationSlotKind, generationMimeTypes, mediaInputKey } from './generationSourceSlots.mjs';
const MAX_SOURCES = 2;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = error => ({ ok: false, error });
/** Existing string arrays remain supported; descriptors assign a Library asset to one declared slot. */
export function readGenerationSources(body) {
    const keys = body?.source_keys !== undefined ? body.source_keys : body?.source_key !== undefined ? [body.source_key] : [];
    if (!Array.isArray(keys) || keys.length > MAX_SOURCES || keys.some(key => typeof key !== 'string' || key.length > 200)) return bad('source_key_invalid');
    const raw = body?.source_assets === undefined ? [] : body.source_assets;
    if (!Array.isArray(raw) || raw.length + keys.length > MAX_SOURCES) return bad('source_asset_invalid');
    const assets = [];
    for (const value of raw) {
        if (typeof value === 'string' && UUID_RE.test(value)) { assets.push({ assetId: value, slot: null }); continue; }
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value,'asset_id') || !Object.hasOwn(value,'slot') || typeof value.asset_id !== 'string' || !UUID_RE.test(value.asset_id) || typeof value.slot !== 'string' || !generationSlotKind(value.slot)) return bad('source_asset_invalid');
        assets.push({ assetId: value.asset_id, slot: value.slot });
    }
    return { ok: true, keys, assets };
}
/** Inspect only after the rate gate and active registry selection. Nothing here debits or dispatches. */
export async function resolveGenerationSources({ authId, keys, assets, record, r2cfg, dbcfg }, deps = {}) {
    const upload = deps.upload || resolveUploadedSource, asset = deps.asset || resolveAssetSource;
    const assigned = new Set();
    for (const ref of assets) {
        if (!ref.slot) continue;
        if (!record?.media || !Object.hasOwn(record.media,ref.slot) || assigned.has(ref.slot)) return bad('source_slot_invalid');
        assigned.add(ref.slot);
    }
    const sources = {}, sourceKeys = {}, sourceAssets = {}, inputs = {}, cache = new Map();
    function put(source, field, reference, target) {
        if (sources[field]) return bad('source_key_invalid');
        sources[field] = { ...source, field }; target[field] = reference; inputs[field] = source.url;
        return { ok: true };
    }
    for (const key of keys) {
        const source = await upload(authId,key,r2cfg);
        if (!source.ok) return source;
        const added = put(source,source.field,key,sourceKeys); if (!added.ok) return added;
    }
    for (const ref of assets) {
        // A legacy string retains its image-only contract. Explicit slots admit only their exact inspected MIME types.
        const kind = ref.slot ? generationSlotKind(ref.slot) : 'image', cacheKey = `${kind}:${ref.assetId}`;
        let source = cache.get(cacheKey);
        if (!source) { source = await asset(authId,ref.assetId,r2cfg,dbcfg,{ kind }); if (!source.ok) return source; cache.set(cacheKey,source); }
        if (!generationMimeTypes(kind).includes(source.contentType)) return bad('source_type_unsupported');
        const added = put(source,ref.slot ? mediaInputKey(ref.slot) : source.field,ref.assetId,sourceAssets); if (!added.ok) return added;
    }
    return { ok: true, sources, sourceKeys, sourceAssets, inputs };
}
export const sourceErrorStatus = error => error === 'source_not_found' ? 404 : error === 'internal' ? 502 : 400;
