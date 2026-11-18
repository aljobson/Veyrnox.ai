import { cropRect, frameRatio, takesFrame } from '../src/lib/aspectFrame';
import { reframePicked } from '../src/lib/reframePicked';
import type { ManipulatorLib } from '../src/lib/chatResizer';

describe('frame crop', () => {
    test('a wide photo cropped to 9:16 keeps its height and is centred', () => {
        expect(cropRect(1600, 900, '9:16')).toEqual({ originX: 547, originY: 0, width: 506, height: 900 });
    });
    test('a tall photo cropped to 16:9 keeps its width', () => {
        expect(cropRect(900, 1600, '16:9')).toEqual({ originX: 0, originY: 547, width: 900, height: 506 });
    });
    test('no crop when the shape already fits or the ratio is empty or unknown', () => {
        expect(cropRect(1920, 1080, '16:9')).toBeNull();
        expect(cropRect(1000, 1000, '')).toBeNull();
        expect(cropRect(1000, 1000, '21:9')).toBeNull();
    });
    test('the thumbnail ratio is width over height of the chosen frame', () => {
        expect(frameRatio('1:1')).toBe(1);
        expect(frameRatio('16:9')).toBeCloseTo(1.778, 3);
        expect(frameRatio('9:16')).toBeCloseTo(0.5625, 4);
    });
    test('only the two Kling 3.0 image-to-video models take it', () => {
        expect(takesFrame('kling-3.0-i2v')).toBe(true);
        expect(takesFrame('kling-3.0-standard-i2v')).toBe(true);
        expect(takesFrame('seedance-2.0-reference')).toBe(false);
    });
});

describe('reframePicked', () => {
    function lib(width: number, height: number) {
        const crops: unknown[] = [];
        const rendered = (w: number, h: number) => ({ width: w, height: h, release() {}, saveAsync: async () => ({ uri: 'file:///cache/framed.jpg', width: w, height: h }) });
        const manipulate = () => {
            let rect: { width: number; height: number } | null = null;
            const ctx = { crop(r: { width: number; height: number }) { crops.push(r); rect = r; return ctx; }, renderAsync: async () => (rect ? rendered(rect.width, rect.height) : rendered(width, height)), release() {} };
            return ctx;
        };
        return { crops, lib: { ImageManipulator: { manipulate }, SaveFormat: { JPEG: 'jpeg' } } as unknown as ManipulatorLib };
    }
    test('crops to the chosen ratio and returns a new JPEG', async () => {
        const { lib: fake, crops } = lib(1600, 900);
        const out = await reframePicked({ uri: 'file:///pick.jpg' }, '1:1', () => fake, () => 123456);
        expect(crops).toEqual([{ originX: 350, originY: 0, width: 900, height: 900 }]);
        expect(out).toMatchObject({ uri: 'file:///cache/framed.jpg', mimeType: 'image/jpeg', framed: true });
    });
    test('the cropped copy carries its byte size, which the upload declares to the server', async () => {
        const { lib: fake } = lib(1600, 900);
        const out = await reframePicked({ uri: 'file:///pick.jpg' }, '1:1', () => fake, () => 123456);
        expect(out.size).toBe(123456);
    });
    test('a copy whose size cannot be read is not sent: the photo goes as it is', async () => {
        const { lib: fake } = lib(1600, 900);
        const file = { uri: 'file:///pick.jpg', size: 4000 };
        const unreadable: Array<() => number | undefined> = [() => undefined, () => 0, () => { throw new Error('locked'); }];
        for (const sizeOf of unreadable) {
            const discard = jest.fn();
            const out = await reframePicked(file, '1:1', () => fake, sizeOf, discard);
            expect(out).toMatchObject({ uri: file.uri, size: 4000, framed: false });
            // The cropped copy is deleted, not left in the cache.
            expect(discard).toHaveBeenCalledWith('file:///cache/framed.jpg');
        }
    });
    test('hands the photo back untouched when it already has the shape', async () => {
        const { lib: fake, crops } = lib(1000, 1000);
        const file = { uri: 'file:///pick.jpg' };
        const out = await reframePicked(file, '1:1', () => fake);
        expect(crops).toEqual([]);
        expect(out).toMatchObject({ uri: file.uri, framed: false });
    });
});
