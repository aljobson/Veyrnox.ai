import { clearHandoff, jpegCopy, offerPhoto, takeOffer } from '../src/lib/liveEdit/faceFilterHandoff';
import { discardCacheCopy } from '../src/lib/cacheFiles';
import { ImageManipulator } from 'expo-image-manipulator';

jest.mock('../src/lib/cacheFiles', () => ({ discardCacheCopy: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: class { size = 123456; } }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));
const file = (name: string) => ({ uri: `file:///cache/${name}.jpg`, size: 10, mimeType: 'image/jpeg', width: 10, height: 10 });
beforeEach(() => { clearHandoff(); jest.clearAllMocks(); });

test('an offered photo is claimed once, by the account that offered it', () => {
    offerPhoto('owner', file('a'));
    expect(takeOffer('owner')?.uri).toBe('file:///cache/a.jpg');
    expect(takeOffer('owner')).toBeNull();
    expect(discardCacheCopy).not.toHaveBeenCalled();
});
test('a newer offer deletes the one nobody claimed', () => {
    offerPhoto('owner', file('a'));
    offerPhoto('owner', file('b'));
    expect(discardCacheCopy).toHaveBeenCalledWith('file:///cache/a.jpg');
    expect(takeOffer('owner')?.uri).toBe('file:///cache/b.jpg');
});
test('another account never receives the photo, and its copy is deleted', () => {
    offerPhoto('owner', file('a'));
    expect(takeOffer('someone-else')).toBeNull();
    expect(discardCacheCopy).toHaveBeenCalledWith('file:///cache/a.jpg');
    expect(takeOffer('owner')).toBeNull();
});
test('clearing deletes an unclaimed copy and is harmless when nothing is waiting', () => {
    clearHandoff();
    expect(discardCacheCopy).not.toHaveBeenCalled();
    offerPhoto('owner', file('a'));
    clearHandoff();
    expect(discardCacheCopy).toHaveBeenLastCalledWith('file:///cache/a.jpg');
    expect(takeOffer('owner')).toBeNull();
});
function manipulator(save: () => Promise<unknown>) {
    const image = { saveAsync: jest.fn(save), release: jest.fn() }, context = { renderAsync: jest.fn(async () => image), release: jest.fn() };
    jest.mocked(ImageManipulator.manipulate).mockReturnValue(context as never);
    return { image, context };
}
test('the upload copy is a JPEG with its real size, and everything native is released', async () => {
    const { image, context } = manipulator(async () => ({ uri: 'file:///cache/out.jpg', width: 4000, height: 3000 }));
    await expect(jpegCopy('file:///cache/full.png')).resolves.toEqual({ uri: 'file:///cache/out.jpg', size: 123456, mimeType: 'image/jpeg', width: 4000, height: 3000 });
    expect(image.saveAsync).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.92 });
    expect(image.release).toHaveBeenCalledTimes(1);
    expect(context.release).toHaveBeenCalledTimes(1);
});
test('a failed copy rejects and still releases everything', async () => {
    const { image, context } = manipulator(async () => { throw Error('disk full'); });
    await expect(jpegCopy('file:///cache/full.png')).rejects.toThrow('disk full');
    expect(image.release).toHaveBeenCalledTimes(1);
    expect(context.release).toHaveBeenCalledTimes(1);
});
