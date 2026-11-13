import { ImageManipulator } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { discardCacheCopy } from '../src/lib/cacheFiles';
import { preparePhoto } from '../src/lib/liveEdit/media';
import { pickLiveMedia, preparePickedPhoto, photoStatus, MAX_PHOTO_BYTES } from '../src/lib/liveEdit/pickedPhoto';
let mockSize = 100, mockWidth = 1200, mockHeight = 800;
const mockRelease = jest.fn();
jest.mock('expo-file-system', () => ({ File: class { get size() { return mockSize; } } }));
jest.mock('expo-video', () => ({}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('../src/lib/cacheFiles', () => ({ discardCacheCopy: jest.fn() }));
jest.mock('../src/lib/liveEdit/media', () => ({ ...jest.requireActual('../src/lib/liveEdit/media'), preparePhoto: jest.fn(async (uri, ids) => ({ ...ids, uri: 'file:///cache/full.png', input: uri })) }));
const ids = { sourceId: 1, frameId: 1 };
const asset = (format: string, mimeType: string | null = `image/${format}`) => ({ uri: `file:///cache/picked.${format}`, mimeType, fileName: `IMG.${format}`, fileSize: 100, width: 1200, height: 800 });
beforeEach(() => {
    jest.clearAllMocks(); mockSize = 100; mockWidth = 1200; mockHeight = 800;
    jest.mocked(ImageManipulator.manipulate).mockImplementation(() => ({
        release: mockRelease,
        renderAsync: async () => ({ release: mockRelease, saveAsync: async () => ({ uri: 'file:///cache/converted.jpg', width: mockWidth, height: mockHeight }) }),
    }) as never);
});
test('picker requests compatible stills, including the still part of Live Photos', async () => {
    const picked = asset('heic');
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [picked] } as never);
    const result = await pickLiveMedia();
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({ mediaTypes: ['images', 'videos'], allowsEditing: false, quality: 1, preferredAssetRepresentationMode: 'compatible' });
    if (!result.canceled) await preparePickedPhoto(result.assets[0], ids);
    expect(preparePhoto).toHaveBeenCalledWith('file:///cache/converted.jpg', ids);
});
test.each(['jpeg', 'png', 'webp'])('%s stays in its original encoding until normalized by preparePhoto', async format => {
    const picked = asset(format); await preparePickedPhoto(picked, ids);
    expect(ImageManipulator.manipulate).not.toHaveBeenCalled();
    expect(preparePhoto).toHaveBeenCalledWith(picked.uri, ids);
    expect(discardCacheCopy).toHaveBeenCalledWith(picked.uri);
});
test.each(['heic', 'heif', 'avif', 'gif', 'tiff', 'bmp', 'heic-sequence', 'heif-sequence'])('%s converts locally to JPEG before validation and preparePhoto', async format => {
    await preparePickedPhoto(asset(format), ids);
    expect(ImageManipulator.manipulate).toHaveBeenCalledWith(asset(format).uri);
    expect(preparePhoto).toHaveBeenCalledWith('file:///cache/converted.jpg', ids);
    expect(discardCacheCopy).toHaveBeenCalledWith('file:///cache/converted.jpg');
    expect(discardCacheCopy).toHaveBeenCalledWith(asset(format).uri);
    expect(mockRelease).toHaveBeenCalledTimes(2);
});
test.each(['HEIC', 'heif', 'avif', 'gif', 'tif', 'bmp', 'jpg', 'png', 'webp'])('missing Android MIME uses the %s extension', async ext => {
    await preparePickedPhoto(asset(ext, null), ids);
    expect(preparePhoto).toHaveBeenCalled();
});
test('generic Android MIME also uses extension fallback', async () => {
    await preparePickedPhoto(asset('avif', 'application/octet-stream'), ids);
    expect(preparePhoto).toHaveBeenCalledWith('file:///cache/converted.jpg', ids);
});
test.each(['image/x-adobe-dng', 'image/tiff', null])('DNG/ProRAW is unsupported, even if mislabeled %s', async mime => {
    await expect(preparePickedPhoto(asset('dng', mime), ids)).rejects.toThrow('unsupportedFormat');
    expect(ImageManipulator.manipulate).not.toHaveBeenCalled(); expect(preparePhoto).not.toHaveBeenCalled();
    expect(discardCacheCopy).toHaveBeenCalledWith(asset('dng').uri);
});
test('a missing native codec is unsupported and releases the conversion context', async () => {
    jest.mocked(ImageManipulator.manipulate).mockReturnValue({ release: mockRelease, renderAsync: async () => { throw Error('native decoder'); } } as never);
    await expect(preparePickedPhoto(asset('heic'), ids)).rejects.toThrow('unsupportedFormat');
    expect(mockRelease).toHaveBeenCalled(); expect(preparePhoto).not.toHaveBeenCalled();
});
test('size and dimensions are validated after conversion and rejected copies are discarded', async () => {
    mockSize = MAX_PHOTO_BYTES + 1;
    await expect(preparePickedPhoto(asset('heic'), ids)).rejects.toThrow('photo-too-large');
    mockSize = 100; mockWidth = 6000; mockHeight = 6000;
    await expect(preparePickedPhoto(asset('avif'), ids)).rejects.toThrow('photo-too-large');
    mockWidth = 8193; mockHeight = 8;
    await expect(preparePickedPhoto(asset('gif'), ids)).rejects.toThrow('photo-too-large');
    expect(preparePhoto).not.toHaveBeenCalled(); expect(discardCacheCopy).toHaveBeenCalledWith('file:///cache/converted.jpg');
});
test('oversize originals do not allocate a conversion and states remain distinct', async () => {
    await expect(preparePickedPhoto({ ...asset('heic'), fileSize: MAX_PHOTO_BYTES + 1 }, ids)).rejects.toThrow('photo-too-large');
    expect(ImageManipulator.manipulate).not.toHaveBeenCalled();
    expect(photoStatus(Error('unsupportedFormat'))).toBe('unsupportedFormat');
    expect(photoStatus(Error('photo-too-large'))).toBe('tooLarge');
    expect(photoStatus(Error('corrupt'))).toBe('invalid');
});
