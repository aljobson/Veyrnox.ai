import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pickCaptionFile, shareCaptionFile } from '../src/lib/editorCaptionFiles';
import { parseCaptions } from '../../../app/veyrnox/_lib/editorCaptions.mjs';
const mockRead = jest.fn(), mockDelete = jest.fn(), mockWrite = jest.fn(), mockCreate = jest.fn();
const mockInfo = jest.fn();
const mockPick = jest.fn(), mockShare = jest.fn(), mockAvailable = jest.fn();
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: unknown[]) => mockPick(...args) }));
jest.mock('expo-sharing', () => ({ shareAsync: (...args: unknown[]) => mockShare(...args), isAvailableAsync: () => mockAvailable() }));
jest.mock('expo-file-system', () => ({ File: class {
    info = mockInfo; uri = 'file:///cache/export'; exists = true; text = mockRead; delete = mockDelete; write = mockWrite; create = mockCreate;
} }));
jest.mock('../src/lib/appCache', () => ({ exportDirectory: () => ({ create: mockCreate }) }));
beforeEach(() => { jest.clearAllMocks(); mockInfo.mockReturnValue({ exists: true, size: 10 }); mockAvailable.mockResolvedValue(true); mockShare.mockResolvedValue(undefined); mockRead.mockResolvedValue('text');
    mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/pick', name: 'a.srt', size: 10 }] }); });
test('cancel and oversize never read; byte preflight agrees with shared parser', async () => {
    mockPick.mockResolvedValueOnce({ canceled: true }); expect(await pickCaptionFile()).toBeNull();
    mockPick.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///cache/pick', name: 'a.srt', size: 262145 }] });
    expect(await pickCaptionFile()).toEqual({ refused: 'fileTooLarge' }); expect(mockRead).not.toHaveBeenCalled();
    expect(parseCaptions('x'.repeat(262145), 'srt')).toHaveProperty('error'); expect(mockDelete).toHaveBeenCalled();
});
test('cached pick deleted on success and read failure', async () => {
    expect(await pickCaptionFile()).toEqual({ text: 'text', name: 'a.srt' });
    expect(mockPick).toHaveBeenCalledWith({ type: ['*/*'], copyToCacheDirectory: true, multiple: false });
    mockRead.mockRejectedValueOnce(new Error('private')); expect(await pickCaptionFile()).toEqual({ refused: 'fileUnreadable' });
    expect(mockDelete).toHaveBeenCalledTimes(2);
});
test('share cleans up on success and failure; unavailable does not write', async () => {
    const file = { name: 'captions.srt' as const, body: 'private', mimeType: 'application/x-subrip', uti: 'public.plain-text' };
    await shareCaptionFile(file); expect(mockDelete).toHaveBeenCalledTimes(1);
    mockShare.mockRejectedValueOnce(new Error('private')); await expect(shareCaptionFile(file)).rejects.toThrow();
    expect(mockDelete).toHaveBeenCalledTimes(2);
    mockAvailable.mockResolvedValue(false); expect(await shareCaptionFile(file)).toBe('unavailable'); expect(mockWrite).toHaveBeenCalledTimes(2);
});
test('IO module contains no logging', () => {
    expect(readFileSync(resolve(__dirname, '../src/lib/editorCaptionFiles.ts'), 'utf8')).not.toMatch(/console\./);
});

test.each([undefined, 262145, 262144, 10])('missing picker size checks file metadata (%s) before reading', async size => {
    mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/pick', name: 'a.srt', size: undefined }] });
    mockInfo.mockReturnValue({ exists: true, size });
    const result = await pickCaptionFile(); expect(mockInfo).toHaveBeenCalledTimes(1);
    if (size === undefined || size > 262144) {
        expect(result).toEqual({ refused: 'fileTooLarge' }); expect(mockRead).not.toHaveBeenCalled();
    } else {
        expect(result).toEqual({ text: 'text', name: 'a.srt' });
        expect(mockInfo.mock.invocationCallOrder[0]).toBeLessThan(mockRead.mock.invocationCallOrder[0]);
    }
    expect(mockDelete).toHaveBeenCalledTimes(1);
});
