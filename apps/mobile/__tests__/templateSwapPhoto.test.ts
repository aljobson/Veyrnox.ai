import { ImageManipulator } from 'expo-image-manipulator';
import { prepareSwapPhoto, LOAD_BOUNDS } from '../src/lib/templateSwap/photo';
import { originalSize, compositePlan } from '../src/lib/templateSwap/photoPlan';
import { encodeComposite } from '../src/lib/templateSwap/composite';
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { PNG: 'png', JPEG: 'jpeg' } }));
jest.mock('../src/lib/cacheFiles', () => ({ discardCacheCopy: jest.fn() }));
const signal = new AbortController().signal;
// Installed expo-image-manipulator/build/ImageManipulator.types.d.ts declares ImageLoadOptions.maxWidth/maxHeight.
// ios/ImageDownsampling.swift uses kCGImageSourceCreateThumbnailWithTransform; ImageManipulatorModule.swift adds
// ImageFixOrientationTransformer BEFORE transforms. Stubbed rotated output verifies that path without a private photo fixture.
// The native fallback in ImageManipulatorUtils.swift can still decode unbounded if thumbnail decode fails (report limitation).
function manipulator() {
    let index = 0;
    jest.mocked(ImageManipulator.manipulate).mockImplementation((_uri, options) => {
        expect(options).toEqual(LOAD_BOUNDS); // fails on EVERY unbounded swap-path load, including HEIC/AVIF
        const thumb = index++ > 0;
        const width = thumb ? 288 : 1152, height = thumb ? 384 : 1536;
        return { resize: jest.fn(), release: jest.fn(), renderAsync: jest.fn(async () => ({ width, height, release: jest.fn(), saveAsync: jest.fn(async () => ({ uri: thumb ? 'file://small.jpg' : 'file://normalized.png', width, height, base64: 'AAAA' })) })) } as never;
    });
}
beforeEach(() => jest.clearAllMocks());
test.each([[8064, 6048], [9000, 5000]])('oversized %ix%i never reaches native load or conversion', async (width, height) => {
    await expect(prepareSwapPhoto({ uri: 'file://input.heic', width, height, mimeType: 'image/heic' }, signal)).rejects.toThrow('photo_too_large');
    expect(ImageManipulator.manipulate).not.toHaveBeenCalled();
});
test('unverifiable input fails before any render', async () => {
    await expect(prepareSwapPhoto({ uri: 'file://no-header' }, signal, async () => null)).rejects.toThrow('invalid_image');
    expect(ImageManipulator.manipulate).not.toHaveBeenCalled();
});
test.each(['jpeg', 'heic', 'avif'])('bounded %s conversion bakes rotation before preview', async ext => {
    manipulator();
    const p = await prepareSwapPhoto({ uri: `file://input.${ext}`, width: 4000, height: 3000 }, signal);
    expect(p.transform).toMatchObject({ originalSource: { width: 4000, height: 3000 }, original: { width: 3000, height: 4000 }, width: 1152, height: 1536, rotation: 0, orientation: 'native-normalized' });
    expect(p.frame).toMatchObject({ width: 288, height: 384 });
    expect(ImageManipulator.manipulate).toHaveBeenCalledTimes(2);
    const resize = jest.mocked(ImageManipulator.manipulate).mock.results[1].value.resize;
    expect(resize).toHaveBeenCalledWith({ width: 288, height: 384 });
});
const landmarks = () => { const p = new Float32Array(1434).fill(.5); p[0] = .35; p[1] = .2; p[3] = .65; p[4] = .4; return p; };
const masks = () => ({ width: 32, height: 32, background: Float32Array.from({ length: 1024 }, (_, i) => i % 32 > 7 && i % 32 < 24 && i / 32 > 4 && i / 32 < 29 ? 0 : 1) });
test('shared face authority and matte refusals; output/crop planning', () => {
    const size = { width: 768, height: 1024 }, face = { count: 1, landmarks: landmarks() };
    const plan = compositePlan(size, face, masks());
    expect(plan.frontal).toMatchObject(size); expect(plan.crop.width).toBeGreaterThanOrEqual(300); expect(plan.crop.height).toBeLessThanOrEqual(1024);
    expect(plan.cropBox.x).toBeGreaterThanOrEqual(0); expect(plan.rgba).toHaveLength(768 * 1024 * 4); expect(plan.blend).toBe('DstIn');
    expect(() => compositePlan(size, { ...face, count: 0 }, masks())).toThrow('no_face');
    expect(() => compositePlan(size, { ...face, count: 2 }, masks())).toThrow('several_people');
    const tiny = landmarks(); tiny[0] = .49; tiny[1] = .49; tiny[3] = .51; tiny[4] = .51;
    expect(() => compositePlan(size, { count: 1, landmarks: tiny }, masks())).toThrow('face_too_small');
    expect(() => compositePlan(size, face, { ...masks(), background: new Float32Array(1024) })).toThrow('busy_background');
    expect(() => originalSize({ width: 299, height: 400 })).toThrow('photo_too_small');
});
test('Skia thin adapter clears grey, masks a layer, crops the composite and encodes PNG', () => {
    const events: string[] = [], paint = { setBlendMode: jest.fn(), dispose: jest.fn() };
    const canvas = { clear: jest.fn(() => events.push('clear')), saveLayer: () => events.push('layer'), drawImageRect: jest.fn(() => events.push('photo')), drawImage: () => events.push('mask'), restore: () => events.push('restore') };
    const snapshot = { encodeToBytes: jest.fn(() => new Uint8Array([137, 80, 78, 71])), dispose: jest.fn() };
    const surface = { getCanvas: () => canvas, flush: () => events.push('flush'), makeImageSnapshot: () => snapshot, dispose: jest.fn() };
    const skia = { Surface: { Make: jest.fn(() => surface) }, Data: { fromBytes: () => ({ dispose: jest.fn() }) }, Image: { MakeImage: jest.fn(() => ({ dispose: jest.fn() })) }, Paint: () => paint, Color: (v: string) => v };
    const plan = compositePlan({ width: 768, height: 1024 }, { count: 1, landmarks: landmarks() }, masks());
    encodeComposite(skia as never, { width: () => 768, height: () => 1024 } as never, plan);
    expect(skia.Surface.Make.mock.calls).toEqual([[768, 1024], [plan.crop.width, plan.crop.height]]);
    expect(canvas.clear).toHaveBeenCalledWith('#808080'); expect(events.slice(0, 6)).toEqual(['clear', 'layer', 'photo', 'mask', 'restore', 'flush']);
    expect(paint.setBlendMode.mock.calls).toEqual([[6], [3]]); expect(snapshot.encodeToBytes.mock.calls).toEqual([[4], [4]]);
    expect(canvas.drawImageRect.mock.calls[1]).toEqual([snapshot, plan.cropBox, { x: 0, y: 0, ...plan.crop }, paint]);
});
test('synthetic disjoint and ragged mattes block through the real shared quality check', () => {
    const grid = (inside: (x: number, y: number) => boolean) => ({ width: 256, height: 256, background: Float32Array.from({ length: 65536 }, (_, i) => inside(i % 256, Math.floor(i / 256)) ? 0 : 1) });
    const face = { count: 1, landmarks: landmarks() }, size = { width: 768, height: 1024 };
    const busy = grid((x, y) => (x >= 70 && x < 180 && y >= 40 && y < 220) || (x > 200 && x < 230 && y > 100 && y < 200));
    const ragged = grid((x, y) => x >= 64 && x < 192 && y >= 64 && y < 192 && (x < 128 || Math.floor(y / 8) % 2 === 0));
    expect(() => compositePlan(size, face, busy)).toThrow('busy_background');
    expect(() => compositePlan(size, face, ragged)).toThrow('ragged_matte');
});
