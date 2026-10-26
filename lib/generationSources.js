import { resolveUploadedSource, resolveAssetSource } from './resolveSource.js';
import { generationSlotKind, generationMimeTypes, mediaInputKey } from './generationSourceSlots.mjs';
import { effectiveMaxFiles, MAX_REFERENCES } from './multiReference.mjs';
import { MAX_REFERENCE_BYTES, typeForKey } from './uploadSource.js';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = error => ({ ok: false, error });
/** Unified descriptors preserve mixed-origin order. Legacy order is uploads then assets. */
export function readGenerationSources(body) {
    if (body?.references !== undefined) {
        if (['source_keys','source_key','source_assets'].some(key => body[key] !== undefined)) return bad('references_ambiguous');
        const references = body.references;
        if (!Array.isArray(references) || references.length > MAX_REFERENCES) return bad('references_invalid');
        for (const ref of references) {
            if (!ref || Array.isArray(ref) || typeof ref !== 'object' || Object.keys(ref).length !== 3 || !generationSlotKind(ref.slot)) return bad('references_invalid');
            if (ref.origin === 'upload' ? typeof ref.key !== 'string' || !ref.key.length || ref.key.length > 200
                : ref.origin === 'asset' ? typeof ref.asset_id !== 'string' || !UUID_RE.test(ref.asset_id) : true) return bad('references_invalid');
        }
        return { ok: true, references, keys: references.filter(r => r.origin === 'upload'), assets: references.filter(r => r.origin === 'asset').map(r => ({ assetId: r.asset_id, slot: r.slot })) };
    }
    const keys = body?.source_keys !== undefined ? body.source_keys : body?.source_key !== undefined ? [body.source_key] : [];
    if (!Array.isArray(keys) || keys.length > MAX_REFERENCES || keys.some(key => typeof key === 'string' ? key.length > 200 : !key || typeof key !== 'object' || Array.isArray(key) || Object.keys(key).length !== 2 || typeof key.key !== 'string' || key.key.length > 200 || !generationSlotKind(key.slot))) return bad('source_key_invalid');
    const raw = body?.source_assets === undefined ? [] : body.source_assets;
    if (!Array.isArray(raw) || raw.length + keys.length > MAX_REFERENCES) return bad('source_asset_invalid');
    const assets = [];
    for (const value of raw) {
        if (typeof value === 'string' && UUID_RE.test(value)) { assets.push({ assetId: value, slot: null }); continue; }
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 || typeof value.asset_id !== 'string' || !UUID_RE.test(value.asset_id) || !generationSlotKind(value.slot)) return bad('source_asset_invalid');
        assets.push({ assetId: value.asset_id, slot: value.slot });
    }
    return { ok: true, keys, assets, references: legacyReferences(keys, assets) };
}
function legacyReferences(keys = [], assets = []) {
    return [...keys.map(r => ({ origin: 'upload', key: typeof r === 'string' ? r : r.key, slot: typeof r === 'string' ? null : r.slot })),
        ...assets.map(r => ({ origin: 'asset', asset_id: r.assetId, slot: r.slot }))];
}
/** Count before inspecting; validate every file before admission. No debit or dispatch here. */
export async function resolveGenerationSources({ authId, references, keys, assets, record, r2cfg, dbcfg }, deps = {}) {
    const refs = (references || legacyReferences(keys, assets)).map(ref => ref.slot ? ref : { ...ref, slot: ref.origin === 'asset' ? 'image' : typeForKey(ref.key)?.field?.replace(/_url$/, '') });
    if (refs.length > MAX_REFERENCES) return bad('source_count_exceeded');
    const upload = deps.upload || resolveUploadedSource, asset = deps.asset || resolveAssetSource;
    const counts = {}, kinds = {};
    function count(slot) {
        const spec = Object.hasOwn(record?.media || {}, slot) && record.media[slot];
        if (!spec) return bad('source_slot_invalid');
        const kind = generationSlotKind(slot);
        counts[slot] = (counts[slot] || 0) + 1; kinds[kind] = (kinds[kind] || 0) + 1;
        if (counts[slot] > effectiveMaxFiles(spec)) return bad('source_count_exceeded');
        if (kinds[kind] > 3) return bad('source_count_exceeded');
        return { ok: true };
    }
    for (const ref of refs) if (ref.slot) { const result = count(ref.slot); if (!result.ok) return result; }
    const sources = {}, sourceKeys = {}, sourceAssets = {}, inputs = {}, cache = new Map(), ordered = [];
    let totalBytes = 0;
    for (const ref of refs) {
        const kind = ref.slot ? generationSlotKind(ref.slot) : 'image';
        const cacheKey = `${ref.origin}:${kind}:${ref.key || ref.asset_id}`;
        let source = cache.get(cacheKey);
        if (!source) {
            source = ref.origin === 'upload' ? await upload(authId, ref.key, r2cfg) : await asset(authId, ref.asset_id, r2cfg, dbcfg, { kind });
            if (!source.ok) return source;
            cache.set(cacheKey, source);
        }
        const slot = ref.slot || ['image','endImage','video','audio'].find(s => mediaInputKey(s) === source.field);
        if (!ref.slot) { const result = count(slot); if (!result.ok) return result; }
        if (!generationMimeTypes(generationSlotKind(slot)).includes(source.contentType)) return bad('source_type_unsupported');
        if (Number.isSafeInteger(source.sizeBytes) && source.sizeBytes > 0) {
            totalBytes += source.sizeBytes;
            if (totalBytes > MAX_REFERENCE_BYTES) return bad('sources_too_large');
        } else if (refs.length > 1) return bad('source_size_unknown'); // a sum needs every size proven; one reference keeps its old tolerance
        const field = mediaInputKey(slot);
        function append(target, value) { target[field] = target[field] === undefined ? value : [...(Array.isArray(target[field]) ? target[field] : [target[field]]), value]; }
        append(sources, { ...source, field }); append(inputs, source.url);
        append(ref.origin === 'upload' ? sourceKeys : sourceAssets, ref.key || ref.asset_id);
        ordered.push(ref.origin === 'upload' ? { slot, origin: 'upload', key: ref.key } : { slot, origin: 'asset', asset_id: ref.asset_id });
    }
    return { ok: true, sources, sourceKeys, sourceAssets, inputs, references: ordered };
}
export const sourceErrorStatus = error => error === 'source_not_found' ? 404 : error === 'internal' ? 502 : 400;
