import { prepareMusicInspirationImage, MUSIC_INSPIRATION_IMAGE_MAX_BYTES } from '../src/lib/music/inspirationImage';
import { discardCacheCopy } from '../src/lib/cacheFiles';

jest.mock('../src/lib/cacheFiles', () => ({ discardCacheCopy: jest.fn() }));

const asset = { uri: 'file:///cache/original-with-exif.jpg', width: 4032, height: 3024 };

test('returns only a newly rendered JPEG with its actual size', async () => {
    const prepare = jest.fn(async () => ({ uri: 'file:///cache/redrawn.jpg', contentType: 'image/jpeg' }));
    await expect(prepareMusicInspirationImage(asset, { prepare, sizeOf: () => 1234 })).resolves.toEqual({
        uri: 'file:///cache/redrawn.jpg', size: 1234, mimeType: 'image/jpeg',
    });
    expect(prepare).toHaveBeenCalledWith(asset);
});

test.each([
    [{ uri: asset.uri, contentType: 'image/jpeg' }, 100, 'image_type'],
    [{ uri: 'file:///cache/out.png', contentType: 'image/png' }, 100, 'image_type'],
    [{ uri: 'file:///cache/out.jpg', contentType: 'image/jpeg' }, MUSIC_INSPIRATION_IMAGE_MAX_BYTES + 1, 'image_too_large'],
    [{ uri: 'file:///cache/out.jpg', contentType: 'image/jpeg' }, 0, 'image_invalid'],
] as const)('rejects unsafe prepared output %# and deletes its cache copy', async (prepared, size, code) => {
    await expect(prepareMusicInspirationImage(asset, { prepare: async () => prepared, sizeOf: () => size })).rejects.toThrow(code);
    if (prepared.uri !== asset.uri) expect(discardCacheCopy).toHaveBeenCalledWith(prepared.uri);
});
