import { portraitBytesFor } from '../src/lib/oddlingsPortraitFile';
import { PORTRAIT_BYTES_MAX } from '../src/lib/oddlingsPuppet';
const mockFile = { exists: false, size: 32, arrayBuffer: jest.fn(), delete: jest.fn() };
const mockDownload = jest.fn();
jest.mock('expo-file-system', () => ({
    Paths: { cache: 'cache' }, Directory: class { exists = true; },
    File: Object.assign(function () { return mockFile; }, { downloadFileAsync: (...args: any[]) => mockDownload(...args) }),
}));
const bytes = new Uint8Array(32);
bytes.set(Buffer.from('RIFF')); bytes.set(Buffer.from('WEBP'), 8);
beforeEach(() => {
    jest.clearAllMocks(); mockFile.exists = true; mockFile.size = 32;
    mockFile.arrayBuffer.mockResolvedValue(bytes.buffer); mockDownload.mockResolvedValue(undefined);
});
test('cached valid WebP bytes are reused without downloading', async () => {
    expect(await portraitBytesFor('duchess-volume')).toEqual(bytes); expect(mockDownload).not.toHaveBeenCalled();
});
test('a cache miss only uses the existing portrait download', async () => {
    mockFile.exists = false;
    expect(await portraitBytesFor('duchess-volume')).toEqual(bytes); expect(mockDownload).toHaveBeenCalledTimes(1);
});
test('invalid IDs, oversized files and non-WebP data are refused', async () => {
    expect(await portraitBytesFor('constructor')).toBeNull(); expect(mockFile.arrayBuffer).not.toHaveBeenCalled();
    mockFile.size = PORTRAIT_BYTES_MAX + 1;
    expect(await portraitBytesFor('duchess-volume')).toBeNull(); expect(mockFile.arrayBuffer).not.toHaveBeenCalled();
    mockFile.size = 32; mockFile.arrayBuffer.mockResolvedValue(new Uint8Array(32).buffer);
    expect(await portraitBytesFor('duchess-volume')).toBeNull(); expect(mockFile.delete).toHaveBeenCalledTimes(2);
});
