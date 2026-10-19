import { checkLocalFile } from './editorMedia.mjs';
import { mediaDetailsProblem } from './editorMediaDetails.mjs';
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => object(v) && Object.keys(v).length === keys.length && Object.keys(v).every(key => keys.includes(key));
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(v);
const packName = v => text(v, 40) && !/[\\/:*?<>|]/.test(v) && !['.', '..'].includes(v) && v.trim() === v;
const fileName = v => text(v, 255) && !/[\\/:]/.test(v) && !['.', '..'].includes(v);
export const ASSET_PACK_CATEGORIES = Object.freeze(['Photos', 'Video', 'Stickers', 'Avatars', 'Music', 'Sound effects']);
export const ASSET_PACK_LIMITS = Object.freeze({ manifestBytes: 131072, assets: 40, totalBytes: 256 * 1024 * 1024 });
/** Extensions are data-only catalogs. No script, URL fetch, account, timeline or billing capability is granted. */
export function assetPackProblem(pack) {
    if (!exact(pack, ['version', 'id', 'name', 'capabilities', 'assets']) || pack.version !== 1 || !id(pack.id) || !packName(pack.name) || !Array.isArray(pack.capabilities) || pack.capabilities.length !== 1 || pack.capabilities[0] !== 'local-catalog') return 'Use a version 1 local-catalog asset pack.';
    if (!Array.isArray(pack.assets) || !pack.assets.length || pack.assets.length > ASSET_PACK_LIMITS.assets) return 'An asset pack holds between 1 and 40 items.';
    const ids = new Set(), names = new Set();
    for (const asset of pack.assets) {
        if (!exact(asset, ['id', 'name', 'file', 'kind', 'category', 'tags', 'sha256', 'attribution']) || !id(asset.id) || ids.has(asset.id) || !text(asset.name, 120) || !fileName(asset.file) || names.has(asset.file) || !['image', 'video', 'audio'].includes(asset.kind) || !ASSET_PACK_CATEGORIES.includes(asset.category) || !Array.isArray(asset.tags) || asset.tags.length > 12 || asset.tags.some(tag => !text(tag, 40)) || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256) || mediaDetailsProblem({ attribution: asset.attribution }) || !asset.attribution?.credit?.trim() || !asset.attribution?.usage?.trim()) return 'An asset has invalid identity, local filename, content hash or licence metadata.';
        if ((['Music', 'Sound effects'].includes(asset.category) && asset.kind !== 'audio') || (['Photos', 'Stickers', 'Avatars'].includes(asset.category) && asset.kind !== 'image') || (asset.category === 'Video' && asset.kind !== 'video')) return 'The asset category must match its media type.';
        ids.add(asset.id); names.add(asset.file);
    }
    if (new TextEncoder().encode(JSON.stringify(pack)).byteLength > ASSET_PACK_LIMITS.manifestBytes) return 'Choose an asset pack under 128 KiB.';
    return null;
}
export function parseAssetPack(source) {
    if (typeof source !== 'string' || new TextEncoder().encode(source).byteLength > ASSET_PACK_LIMITS.manifestBytes) return { error: 'Choose an asset pack under 128 KiB.' };
    try { const pack = JSON.parse(source), error = assetPackProblem(pack); return error ? { error } : { pack }; } catch { return { error: 'Choose a valid asset-pack JSON file.' }; }
}
export function matchingPackAssets(pack, { query = '', category = 'All' } = {}) {
    const needle = query.toLowerCase();
    return pack.assets.filter(asset => (category === 'All' || asset.category === category) && [asset.name, asset.category, ...asset.tags, asset.attribution.credit, asset.attribution.usage].join(' ').toLowerCase().includes(needle));
}
/** Match only explicit local File selections and compare the declared digest before ingestion. */
export async function verifyPackFile(pack, assetId, files, { signal } = {}) {
    const problem = assetPackProblem(pack); if (problem) throw new Error(problem);
    const asset = pack.assets.find(item => item.id === assetId); if (!asset) throw new Error('Choose an item in this asset pack.');
    const selected = Array.from(files || []);
    if (selected.length > 40 || selected.reduce((sum, file) => sum + file.size, 0) > ASSET_PACK_LIMITS.totalBytes) throw new Error('Choose up to 40 files totalling 256 MiB.');
    const matches = selected.filter(file => file.name === asset.file);
    if (matches.length !== 1) throw new Error(`Select exactly one local file named ${asset.file}.`);
    if (signal?.aborted) throw new DOMException('Asset import cancelled.', 'AbortError');
    const file = matches[0], check = checkLocalFile(file);
    if (check.error) throw new Error(check.error);
    if (check.kind !== asset.kind) throw new Error('The selected file type does not match this catalog item.');
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    if (signal?.aborted) throw new DOMException('Asset import cancelled.', 'AbortError');
    const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    if (hash !== asset.sha256) throw new Error('The file does not match this catalog item’s recorded hash.');
    return { file, name: asset.name, details: { sourceName: asset.file, folder: `Asset packs/${pack.name}/${asset.category}`.slice(0, 80), attribution: { ...asset.attribution } } };
}
export async function createAssetPack(files, { name, credit, usage, url = '', signal } = {}) {
    const selected = Array.from(files || []);
    if (!selected.length || selected.length > 40 || selected.reduce((sum, file) => sum + file.size, 0) > ASSET_PACK_LIMITS.totalBytes) throw new Error('Choose between 1 and 40 files totalling 256 MiB.');
    const attribution = { credit, usage, url };
    if (!packName(name) || mediaDetailsProblem({ attribution }) || !credit?.trim() || !usage?.trim()) throw new Error('Enter a pack name, creator and usage rights.');
    const assets = [];
    for (let i = 0; i < selected.length; i++) {
        if (signal?.aborted) throw new DOMException('Asset pack creation cancelled.', 'AbortError');
        const file = selected[i], check = checkLocalFile(file); if (check.error) throw new Error(check.error);
        const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        const sha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
        assets.push({ id: `asset-${i + 1}`, name: file.name.slice(0, 120), file: file.name, kind: check.kind, category: check.kind === 'audio' ? 'Music' : check.kind === 'video' ? 'Video' : 'Photos', tags: [], sha256, attribution: { ...attribution } });
    }
    if (signal?.aborted) throw new DOMException('Asset pack creation cancelled.', 'AbortError');
    const pack = { version: 1, id: `pack-${crypto.randomUUID()}`, name, capabilities: ['local-catalog'], assets };
    const problem = assetPackProblem(pack); if (problem) throw new Error(problem);
    return pack;
}
