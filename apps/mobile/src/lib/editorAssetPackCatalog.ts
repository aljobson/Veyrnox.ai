import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { assetPackProblem, ASSET_PACK_LIMITS, parseAssetPack } from '../../../../app/veyrnox/_lib/editorAssetPacks.mjs';
import { checkLocalFile } from '../../../../app/veyrnox/_lib/editorMedia.mjs';
import { exportDirectory, getCacheUser, subscribeCacheUser, userDocStorage } from './appCache';
import type { CacheStorage } from './cache';
import { canonicalType } from './editorServerExportUploads';

export type PackKind = 'image' | 'video' | 'audio';
export type PackAttribution = { credit: string; usage: string; url: string };
export type PackAsset = { id: string; name: string; file: string; kind: PackKind; category: string; tags: string[]; sha256: string; attribution: PackAttribution };
export type AssetPack = { version: 1; id: string; name: string; capabilities: ['local-catalog']; assets: PackAsset[] };
export type PickedPackFile = { uri: string; name: string; size?: number | null; mimeType?: string | null };
export type PackFileProblem = 'invalidManifest' | 'missingItem' | 'wrongName' | 'invalidFile' | 'wrongType' | 'accountChanged';
type CatalogRecord = { owner: string; packs: AssetPack[] };

const PREFIX = 'editor-asset-packs.';
const MAX_PACKS = 12;
const key = (owner: string) => `${PREFIX}${owner}`;
const validPack = (value: unknown): value is AssetPack => !assetPackProblem(value);
const lower = (value: string | null | undefined) => String(value || '').trim().toLowerCase();
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg' };
const mimeOf = (picked: PickedPackFile) => {
    const reported = canonicalType(lower(picked.mimeType)), fallback = MIME[picked.name.split('.').pop()?.toLowerCase() || ''] || '';
    return checkLocalFile({ size: picked.size ?? 1, type: reported }).error ? fallback : reported;
};
export const packFileMime = (picked: PickedPackFile) => mimeOf(picked);

export function parseNativeAssetPack(source: string): { pack: AssetPack } | { problem: 'manifestTooLarge' | 'invalidManifest' } {
    if (typeof source !== 'string' || new TextEncoder().encode(source).byteLength > ASSET_PACK_LIMITS.manifestBytes) return { problem: 'manifestTooLarge' };
    const result = parseAssetPack(source) as { pack?: AssetPack; error?: string };
    return result.pack && validPack(result.pack) ? { pack: result.pack } : { problem: 'invalidManifest' };
}

export function packFileProblem(pack: AssetPack, assetId: string, picked: PickedPackFile): PackFileProblem | null {
    if (!validPack(pack)) return 'invalidManifest';
    const asset = pack.assets.find(item => item.id === assetId); if (!asset) return 'missingItem';
    if (picked.name !== asset.file) return 'wrongName';
    const file = new File(picked.uri), size = picked.size ?? file.size;
    if (!file.exists || !Number.isSafeInteger(size) || size <= 0 || file.size !== size) return 'invalidFile';
    const check = checkLocalFile({ size, type: mimeOf(picked) });
    if (check.error) return 'invalidFile';
    return check.kind === asset.kind ? null : 'wrongType';
}

export function packMediaDetails(pack: AssetPack, asset: PackAsset) {
    return { sourceName: asset.file, folder: `Asset packs/${pack.name}/${asset.category}`.slice(0, 80), attribution: { ...asset.attribution } };
}

export function createAssetPackCatalog(storage: CacheStorage = userDocStorage) {
    let owner: string | null = null, epoch = 0, pending: Promise<unknown> = Promise.resolve();
    const serial = <T,>(work: () => Promise<T>) => { const result = pending.catch(() => undefined).then(work); pending = result; return result; };
    const live = (token: number, expected: string) => token === epoch && owner === expected;
    function setOwner(next: string | null) { if (next !== owner) epoch++; owner = next; }
    async function read(expected: string, token: number) {
        const raw = await storage.get(key(expected)); if (!live(token, expected)) return [];
        try {
            const record = JSON.parse(raw || 'null') as CatalogRecord | null;
            return record?.owner === expected && Array.isArray(record.packs) ? record.packs.filter(validPack).slice(0, MAX_PACKS) : [];
        } catch { return []; }
    }
    const list = () => { const expected = owner, token = epoch; return expected ? serial(() => read(expected, token)) : Promise.resolve([]); };
    const upsert = (pack: AssetPack) => { const expected = owner, token = epoch; return serial(async () => {
        if (!expected || !live(token, expected) || !validPack(pack)) return null;
        const current = await read(expected, token); if (!live(token, expected)) return null;
        const packs = [pack, ...current.filter(item => item.id !== pack.id)].slice(0, MAX_PACKS);
        await storage.set(key(expected), JSON.stringify({ owner: expected, packs } satisfies CatalogRecord));
        return live(token, expected) ? packs : null;
    }); };
    const remove = (packId: string) => { const expected = owner, token = epoch; return serial(async () => {
        if (!expected || !live(token, expected)) return null;
        const packs = (await read(expected, token)).filter(item => item.id !== packId); if (!live(token, expected)) return null;
        await storage.set(key(expected), JSON.stringify({ owner: expected, packs } satisfies CatalogRecord));
        return live(token, expected) ? packs : null;
    }); };
    return { setOwner, list, upsert, remove };
}

export const editorAssetPackCatalog = createAssetPackCatalog();
editorAssetPackCatalog.setOwner(getCacheUser() ?? null);
subscribeCacheUser(() => { editorAssetPackCatalog.setOwner(getCacheUser() ?? null); });

export async function createNativeAssetPack(files: readonly PickedPackFile[], fields: { name: string; credit: string; usage: string; url: string },
    live: () => boolean = () => true, progress: (done: number, total: number) => void = () => {}): Promise<AssetPack | null> {
    if (!files.length || files.length > ASSET_PACK_LIMITS.assets) return null;
    const sources = files.map(picked => ({ picked, file: new File(picked.uri) }));
    if (sources.some(({ picked, file }) => !file.exists || !Number.isSafeInteger(file.size) || file.size <= 0
        || picked.size != null && picked.size !== file.size)) return null;
    const total = sources.reduce((sum, item) => sum + item.file.size, 0);
    if (!Number.isSafeInteger(total) || total <= 0 || total > ASSET_PACK_LIMITS.totalBytes) return null;
    const prepared = sources.map(({ picked, file }, index) => {
        const check = checkLocalFile({ size: file.size, type: mimeOf(picked) });
        return { picked, file, check, asset: { id: `asset-${index + 1}`, name: picked.name.slice(0, 120), file: picked.name,
            kind: check.kind as PackKind, category: check.kind === 'audio' ? 'Music' : check.kind === 'video' ? 'Video' : 'Photos', tags: [], sha256: '0'.repeat(64),
            attribution: { credit: fields.credit.trim(), usage: fields.usage.trim(), url: fields.url.trim() } } satisfies PackAsset };
    });
    const id = `pack-${randomUUID()}`, draft = { version: 1 as const, id, name: fields.name.trim(), capabilities: ['local-catalog'] as ['local-catalog'],
        assets: prepared.map(item => item.asset) };
    if (prepared.some(item => !item.file.exists || item.check.error || !item.check.kind) || !validPack(draft)) return null;
    const assets: PackAsset[] = [];
    for (const [index, item] of prepared.entries()) {
        if (!live()) return null;
        const sha256 = await item.file.digest('SHA-256'); if (!live()) return null;
        assets.push({ ...item.asset, sha256 });
        progress(index + 1, files.length);
    }
    const pack = { ...draft, assets };
    return validPack(pack) ? pack : null;
}

export async function shareNativeAssetPack(pack: AssetPack, live: () => boolean = () => true): Promise<'unavailable' | void> {
    if (!validPack(pack) || !await Sharing.isAvailableAsync() || !live()) return 'unavailable';
    const directory = exportDirectory(); directory.create({ intermediates: true, idempotent: true });
    const file = new File(directory, `${pack.id}.json`);
    try {
        file.create({ overwrite: true }); await file.write(JSON.stringify(pack, null, 2)); if (!live()) return;
        await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json' });
    } finally { if (Platform.OS !== 'android') try { if (file.exists) file.delete(); } catch { /* Best-effort private export cleanup. */ } }
}
