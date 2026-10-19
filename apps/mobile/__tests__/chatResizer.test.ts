import { MAX_IMAGE_EDGE } from '../src/lib/chatAttach';
import { createResizer, JPEG_QUALITY, type ManipulatorLib } from '../src/lib/chatResizer';

// Whether or not the native module is installed in this checkout, the default loader sees it fail to load.
jest.mock('expo-image-manipulator', () => { throw new Error('native module missing'); }, { virtual: true });

// A fake of expo-image-manipulator's context API. `upright` is the size after the camera's rotation is applied.
function fake(upright: { width: number; height: number }) {
    const calls: { resize: { width: number; height: number }[]; saved: { compress: number; format: string }[]; renders: number } = { resize: [], saved: [], renders: 0 };
    const rendered = (w: number, h: number) => ({
        width: w,
        height: h,
        saveAsync: async (o: { compress: number; format: string }) => (calls.saved.push(o), { uri: `file:///out-${w}x${h}.jpg`, width: w, height: h }),
    });
    const lib: ManipulatorLib = {
        SaveFormat: { JPEG: 'jpeg' },
        ImageManipulator: {
            manipulate: () => {
                let size = upright;
                const ctx = {
                    resize: (s: { width: number; height: number }) => (calls.resize.push(s), (size = s), ctx),
                    renderAsync: async () => (calls.renders++, rendered(size.width, size.height)),
                };
                return ctx;
            },
        },
    };
    return { lib, calls };
}

const image = { uri: 'file:///p.heic', width: 4032, height: 3024 };

describe('phone photo resizer', () => {
    test('a large photo is scaled to the 2048 long edge and saved as JPEG', async () => {
        const { lib, calls } = fake({ width: 4032, height: 3024 });
        const out = await createResizer(() => lib).prepare(image, MAX_IMAGE_EDGE);
        expect(calls.resize).toEqual([{ width: 2048, height: 1536 }]);
        expect(calls.saved).toEqual([{ compress: JPEG_QUALITY, format: 'jpeg' }]);
        expect(out).toEqual({ uri: 'file:///out-2048x1536.jpg', contentType: 'image/jpeg' });
    });
    test('orientation: the cap follows the upright size, not the picker size', async () => {
        // The picker said 4032 wide by 3024 high, but the camera rotated it: upright it is 3024 wide by 4032 high.
        const { lib, calls } = fake({ width: 3024, height: 4032 });
        await createResizer(() => lib).prepare(image, MAX_IMAGE_EDGE);
        expect(calls.resize).toEqual([{ width: 1536, height: 2048 }]);
    });
    test('a photo already within the cap is not scaled but is still re-encoded', async () => {
        const { lib, calls } = fake({ width: 1600, height: 1200 });
        const out = await createResizer(() => lib).prepare({ ...image, width: 1600, height: 1200 }, MAX_IMAGE_EDGE);
        expect(calls.resize).toEqual([]);
        expect(calls.saved).toHaveLength(1);
        expect(out.contentType).toBe('image/jpeg');
    });
    test('the long edge is never over the cap', async () => {
        for (const [w, h] of [[2049, 10], [10, 5000], [2048, 2048], [9000, 9000]]) {
            const { lib, calls } = fake({ width: w, height: h });
            await createResizer(() => lib).prepare({ uri: 'x', width: w, height: h }, MAX_IMAGE_EDGE);
            const s = calls.resize[0] ?? { width: w, height: h };
            expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(MAX_IMAGE_EDGE);
        }
    });
    test('a build without the native module reads as resize unavailable', async () => {
        await expect(createResizer().prepare(image, MAX_IMAGE_EDGE)).rejects.toThrow('resize_unavailable');
    });
});
