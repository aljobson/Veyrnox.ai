import { pickedImageFile } from '../src/lib/pickedImage';

jest.mock('expo-file-system', () => ({ File: class { exists = false; }, Paths: { cache: { uri: 'file:///cache/' } } }));

function manipulator() {
    const saveAsync = jest.fn(async () => ({ uri: 'file:///cache/out.jpg', width: 40, height: 30 }));
    const load = jest.fn(() => ({
        ImageManipulator: { manipulate: jest.fn(() => ({ renderAsync: async () => ({ saveAsync }) })) },
        SaveFormat: { JPEG: 'jpeg' },
    })) as never;
    return { load, saveAsync };
}

describe('pickedImageFile', () => {
    it.each(['image/jpeg', 'image/png', 'image/webp'])('keeps %s as picked', async (mimeType) => {
        const { load } = manipulator();
        const file = await pickedImageFile({ uri: 'file:///cache/a', mimeType, fileSize: 10 }, { load });
        expect(file).toMatchObject({ uri: 'file:///cache/a', mimeType, size: 10 });
        expect(load).not.toHaveBeenCalled();
    });
    it.each(['image/heic', 'image/heif', 'image/avif'])('converts %s to JPEG', async (mimeType) => {
        const { load, saveAsync } = manipulator();
        const file = await pickedImageFile({ uri: 'file:///cache/a', mimeType, fileSize: 10 }, { load, sizeOf: () => 77 });
        expect(saveAsync).toHaveBeenCalledWith({ compress: 1, format: 'jpeg' });
        expect(file).toEqual({ uri: 'file:///cache/out.jpg', mimeType: 'image/jpeg', size: 77, width: 40, height: 30 });
    });
    it('converts a HEIC file that arrives with no type', async () => {
        const { load } = manipulator();
        const file = await pickedImageFile({ uri: 'content://media/IMG_1.HEIC', mimeType: null }, { load, sizeOf: () => 5 });
        expect(file.mimeType).toBe('image/jpeg');
    });
    it('leaves an unknown non-image alone so the type check reports it', async () => {
        const { load } = manipulator();
        const file = await pickedImageFile({ uri: 'file:///cache/a.pdf', mimeType: 'application/pdf', fileSize: 3 }, { load });
        expect(file.mimeType).toBe('application/pdf');
        expect(load).not.toHaveBeenCalled();
    });
});
