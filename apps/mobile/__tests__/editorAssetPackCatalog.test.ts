import { createMemoryStorage } from '../src/lib/cache';
import { assetPackProblem } from '../../../app/veyrnox/_lib/editorAssetPacks.mjs';
import { createAssetPackCatalog, createNativeAssetPack, packFileMime, packFileProblem, parseNativeAssetPack, shareNativeAssetPack, type AssetPack } from '../src/lib/editorAssetPackCatalog';
import * as Sharing from 'expo-sharing';

const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const hash = 'a'.repeat(64), mockFiles = new Map<string, { body: string; digest: string; size?: number }>(), mockDigest = jest.fn(async (uri: string) => mockFiles.get(uri)?.digest ?? '');
const mockStorage = createMemoryStorage();
jest.mock('expo-crypto', () => ({ randomUUID: () => '33333333-3333-4333-8333-333333333333' }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
jest.mock('../src/lib/appCache', () => ({
    getCacheUser: () => '11111111-1111-4111-8111-111111111111', subscribeCacheUser: () => () => {}, userDocStorage: mockStorage,
    exportDirectory: () => ({ uri: 'file:///exports', exists: true, create: jest.fn() }),
}));
jest.mock('expo-file-system', () => {
    class File {
        uri: string; constructor(...parts: (string | { uri: string })[]) { this.uri = parts.map(item => typeof item === 'string' ? item : item.uri).join('/'); }
        get exists() { return mockFiles.has(this.uri); } get size() { const item = mockFiles.get(this.uri); return item?.size ?? new TextEncoder().encode(item?.body ?? '').byteLength; }
        async text() { return mockFiles.get(this.uri)?.body ?? ''; } async digest() { return mockDigest(this.uri); }
        create() { mockFiles.set(this.uri, { body: '', digest: '' }); } async write(value: string) { mockFiles.set(this.uri, { body: value, digest: '' }); }
        delete() { mockFiles.delete(this.uri); }
    }
    return { File };
});

const pack: AssetPack = { version: 1, id: 'pack-one', name: 'Studio Kit', capabilities: ['local-catalog'], assets: [{ id: 'asset-1', name: 'Backdrop', file: 'backdrop.png',
    kind: 'image', category: 'Photos', tags: ['blue'], sha256: hash, attribution: { credit: 'Creator', usage: 'Licensed for this edit', url: 'https://example.test/licence' } }] };

beforeEach(async () => {
    mockFiles.clear(); jest.clearAllMocks(); for (const key of await mockStorage.keys()) await mockStorage.remove(key);
    mockFiles.set('file:///pick/backdrop.png', { body: 'png-data', digest: hash });
});

test('native parsing reuses the strict data-only manifest contract', () => {
    expect(parseNativeAssetPack(JSON.stringify(pack))).toEqual({ pack });
    expect(parseNativeAssetPack(JSON.stringify({ ...pack, capabilities: ['network'] }))).toEqual({ problem: 'invalidManifest' });
    expect(parseNativeAssetPack(JSON.stringify({ ...pack, assets: [{ ...pack.assets[0], file: '../backdrop.png' }] }))).toEqual({ problem: 'invalidManifest' });
    expect(parseNativeAssetPack('x'.repeat(131073))).toEqual({ problem: 'manifestTooLarge' });
});

test('file preflight requires the exact local name, bounded size and declared kind', () => {
    const picked = { uri: 'file:///pick/backdrop.png', name: 'backdrop.png', size: 8, mimeType: 'image/png' };
    expect(packFileProblem(pack, 'asset-1', picked)).toBeNull();
    expect(packFileProblem(pack, 'asset-1', { ...picked, mimeType: null })).toBeNull();
    expect(packFileProblem(pack, 'asset-1', { ...picked, name: 'other.png' })).toBe('wrongName');
    expect(packFileProblem(pack, 'asset-1', { ...picked, mimeType: 'audio/mpeg' })).toBe('wrongType');
    expect(packFileProblem(pack, 'missing', picked)).toBe('missingItem');
    expect(packFileMime({ ...picked, name: 'sound.wav', mimeType: 'audio/vnd.wave' })).toBe('audio/wav');
    expect(packFileMime({ ...picked, name: 'sound.wav', mimeType: 'audio/x-wav' })).toBe('audio/wav');
});

test('catalog manifests persist outside projects and remain isolated by account', async () => {
    const catalog = createAssetPackCatalog(mockStorage); catalog.setOwner(owner);
    expect(await catalog.upsert(pack)).toEqual([pack]); expect(await catalog.list()).toEqual([pack]);
    catalog.setOwner(other); expect(await catalog.list()).toEqual([]);
    catalog.setOwner(owner); expect(await catalog.list()).toEqual([pack]);
    expect([...await mockStorage.keys()]).toEqual([`editor-asset-packs.${owner}`]);
});

test('create hashes files locally, produces a valid manifest, and shares JSON without retaining media bytes', async () => {
    const progress = jest.fn(); const created = await createNativeAssetPack([{ uri: 'file:///pick/backdrop.png', name: 'backdrop.png', size: 8, mimeType: 'image/png' }],
        { name: 'My Pack', credit: 'Creator', usage: 'Original work', url: '' }, () => true, progress);
    expect(created && assetPackProblem(created)).toBeNull(); expect(created?.assets[0]).toMatchObject({ file: 'backdrop.png', sha256: hash, kind: 'image' });
    expect(JSON.stringify(created)).not.toContain('file:///pick'); expect(progress).toHaveBeenCalledWith(1, 1);
    await shareNativeAssetPack(created!); expect(Sharing.shareAsync).toHaveBeenCalledWith(expect.stringContaining('pack-33333333-3333-4333-8333-333333333333.json'),
        { mimeType: 'application/json', UTI: 'public.json' });
    expect([...mockFiles.keys()].some(path => path.includes('/exports/'))).toBe(false);
});

test('create rejects invalid metadata and duplicate file names before hashing', async () => {
    const file = { uri: 'file:///pick/backdrop.png', name: 'backdrop.png', size: 8, mimeType: 'image/png' };
    expect(await createNativeAssetPack([file], { name: 'Bad/Pack', credit: 'Creator', usage: 'Original', url: '' })).toBeNull();
    expect(await createNativeAssetPack([file], { name: 'Pack', credit: 'Creator', usage: 'Original', url: 'http://example.test' })).toBeNull();
    expect(await createNativeAssetPack([file, file], { name: 'Pack', credit: 'Creator', usage: 'Original', url: '' })).toBeNull();
    expect(mockDigest).not.toHaveBeenCalled();
});

test('create trusts actual native file size, not a stale picker size, before hashing', async () => {
    mockFiles.set('file:///pick/oversized.png', { body: '', digest: hash, size: 256 * 1024 * 1024 + 1 });
    const created = await createNativeAssetPack([{ uri: 'file:///pick/oversized.png', name: 'oversized.png', size: 8, mimeType: 'image/png' }],
        { name: 'Pack', credit: 'Creator', usage: 'Original', url: '' });
    expect(created).toBeNull(); expect(mockDigest).not.toHaveBeenCalled();
});
