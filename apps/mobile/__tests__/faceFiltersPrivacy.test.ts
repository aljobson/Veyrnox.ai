import { bindCacheUser, getCacheUser, resetCacheUser, subscribeCacheUser, wipeCache } from '../src/lib/appCache';
import { checkPicked } from '../src/lib/sources';
import { shortfall } from '../src/lib/lowBalance';
import { faceDefaults, faceInputs } from '../src/lib/faceFilters';
import type { CatalogModel } from '../src/lib/media';

beforeEach(() => resetCacheUser());
test('account switch and sign-out invalidate photo owners before asynchronous cache clearing', async () => {
    const cache = { clear: jest.fn(async () => {}) } as any;
    const storage = { get: async () => null, set: async () => {}, remove: async () => {}, keys: async () => [] };
    const seen: (string | undefined)[] = [];
    const off = subscribeCacheUser(() => { seen.push(getCacheUser()); });
    await bindCacheUser('first-owner', cache, storage);
    await bindCacheUser('first-owner', cache, storage);
    await bindCacheUser('next-owner', cache, storage);
    await wipeCache(cache);
    expect(seen).toEqual(['first-owner', 'next-owner', undefined]);
    off();
    await bindCacheUser('third-owner', cache, storage);
    expect(seen).toHaveLength(3);
});
test.each(['image/jpeg', 'image/png', 'image/webp'])('%s accepts the server cap but not one byte more', mimeType => {
    const file = { uri: 'file:///local', mimeType, size: 20 * 1024 * 1024 };
    expect(checkPicked('image', file).ok).toBe(true);
    expect(checkPicked('image', { ...file, size: file.size + 1 })).toEqual({ ok: false, error: 'too_large' });
});
test('unsupported formats and unknown sizes are rejected before uploading', () => {
    expect(checkPicked('image', { uri: 'file:///local', mimeType: 'image/heic', size: 100 }).ok).toBe(false);
    expect(checkPicked('image', { uri: 'file:///local', mimeType: 'image/jpeg' }).ok).toBe(false);
});
test('balance shortfall uses the same ADR-0220 helper as Create', () => {
    expect(shortfall(2, 17)).toBe(15);
    expect(shortfall(17, 17)).toBe(0);
    expect(shortfall(null, 17)).toBe(0);
});
test('displayed defaults are the values sent and pinned identity is never exposed', () => {
    const model: CatalogModel = { id: 'face-age', name: 'Age', modality: 'image', credits: 19, gated: false, durations: [], capabilities: { inputs: { target_age: { type: 'int', min: 18, max: 100 } }, media: { image: { required: true } } } };
    expect(faceDefaults(model)).toEqual({ target_age: 30 });
    expect(faceInputs(model, faceDefaults(model))).toEqual({ target_age: 30 });
    expect(faceInputs(model, { target_age: 30, preserve_identity: false })).toEqual({ target_age: 30 });
});
