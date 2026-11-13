import { renderEffects, saveEffectsToPhotos, renderLook, saveLookToPhotos } from '../src/lib/lookExport';
import { createInferenceLifecycle } from '../src/lib/liveEdit/lifecycle';
import type { Inference } from '../src/lib/liveEdit/protocol';
import { normalizeStack } from '../src/lib/liveEdit/engine';
import { renderEffectStack } from '../src/lib/liveEdit/renderEffectStack';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
const mockDelete = jest.fn(), mockWrite = jest.fn(), mockDraw = jest.fn(), mockDispose = jest.fn();
const mockEncode = jest.fn(() => new Uint8Array([1, 2, 3]));
const mockImage = { width: () => 300, height: () => 200, dispose: mockDispose };
jest.mock('expo-file-system', () => ({ Paths: { cache: 'file:///cache/' }, File: class { exists = true; uri = 'file:///cache/export.png'; create() {} write = mockWrite; delete = mockDelete; } }));
jest.mock('expo-media-library', () => ({ requestPermissionsAsync: jest.fn(), Asset: { create: jest.fn() } }));
jest.mock('@shopify/react-native-skia', () => ({ ImageFormat: { PNG: 4, JPEG: 3 }, Skia: {
    Data: { fromURI: async () => ({ dispose: mockDispose }) }, Image: { MakeImageFromEncoded: () => mockImage },
    Surface: { Make: () => ({ getCanvas: () => ({ drawPicture: mockDraw }), flush() {}, dispose: mockDispose,
        makeImageSnapshot: () => ({ encodeToBytes: mockEncode, dispose: mockDispose }) }) },
} }));
jest.mock('../src/lib/liveEdit/renderEffectStack', () => ({ renderEffectStack: jest.fn(() => ({ dispose: mockDispose })) }));
beforeEach(() => { jest.clearAllMocks(); jest.mocked(requestPermissionsAsync).mockResolvedValue({ granted: true } as never); jest.mocked(Asset.create).mockResolvedValue({} as never); });
const stack = normalizeStack({ smoothing: .6, look: 'glow' }), ids = { sourceId: 2, frameId: 3 };
test('export calls the preview renderer with the complete stack and matching source ids', async () => {
    mockWrite.mockImplementationOnce(() => expect(mockDispose).toHaveBeenCalledTimes(5));
    await renderEffects('file:///photo.png', stack, null, ids);
    expect(renderEffectStack).toHaveBeenCalledWith({ image: mockImage, ...ids }, stack, null);
    expect(mockDraw).toHaveBeenCalledTimes(1); expect(mockWrite).toHaveBeenCalledTimes(1); expect(mockDispose).toHaveBeenCalledTimes(5);
});
test('permissions denied do not render, and switched owner never saves', async () => {
    jest.mocked(requestPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
    await expect(saveEffectsToPhotos('file:///photo.png', stack, null, ids, () => true)).resolves.toBe(false);
    expect(renderEffectStack).not.toHaveBeenCalled();
    let calls = 0;
    await expect(saveEffectsToPhotos('file:///photo.png', stack, null, ids, () => ++calls < 3)).rejects.toThrow('look_export_cancelled');
    expect(Asset.create).not.toHaveBeenCalled(); expect(mockDelete).toHaveBeenCalledTimes(1);
});
test('save failure still removes the generated cache copy', async () => {
    jest.mocked(Asset.create).mockRejectedValueOnce(Error('native failure'));
    await expect(saveEffectsToPhotos('file:///photo.png', stack, null, ids, () => true)).rejects.toThrow();
    expect(mockDelete).toHaveBeenCalledTimes(1);
});

test('legacy face-filter saves keep JPEG q92 while Live Edit uses PNG', async () => {
    await renderLook('file:///photo.jpg', { id: 'warm', strength: .8 });
    expect(mockEncode).toHaveBeenLastCalledWith(3, 92);
    await saveLookToPhotos('file:///photo.jpg', { id: 'warm', strength: .8 });
    expect(mockEncode).toHaveBeenLastCalledWith(3, 92);
    await saveEffectsToPhotos('file:///photo.png', stack, null, ids, () => true);
    expect(mockEncode).toHaveBeenLastCalledWith(4, 100);
});

test('permission inactive/active preserves the full inference snapshot on save', async () => {
    const lifecycle = createInferenceLifecycle(), lease = lifecycle.reset(); lifecycle.accept(lease);
    const inference: Inference = { ...ids, count: 1, landmarks: new Float32Array(1434), hair: { width: 8, height: 8, hair: new Float32Array(64) } };
    jest.mocked(requestPermissionsAsync).mockImplementationOnce(async () => {
        lifecycle.transition('inactive'); lifecycle.transition('active');
        return { granted: true } as never;
    });
    await expect(saveEffectsToPhotos('file:///photo.png', stack, inference, ids, () => lifecycle.owns(lease))).resolves.toBe(true);
    expect(renderEffectStack).toHaveBeenCalledWith({ image: mockImage, ...ids }, stack, inference);
    expect(Asset.create).toHaveBeenCalledTimes(1);
});
test('background during the save permission prompt cancels export until fresh inference', async () => {
    const lifecycle = createInferenceLifecycle(), lease = lifecycle.reset(); lifecycle.accept(lease);
    jest.mocked(requestPermissionsAsync).mockImplementationOnce(async () => {
        lifecycle.transition('background'); expect(lifecycle.transition('active')).toBe('refresh');
        return { granted: true } as never;
    });
    await expect(saveEffectsToPhotos('file:///photo.png', stack, null, ids, () => lifecycle.owns(lease))).rejects.toThrow('look_export_cancelled');
    expect(renderEffectStack).not.toHaveBeenCalled(); expect(Asset.create).not.toHaveBeenCalled();
    expect(lifecycle.canSave).toBe(false);
});
