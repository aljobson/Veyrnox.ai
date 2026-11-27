import { emptyProjectDocument } from '../../../lib/projectDocument.js';
import { withTimeline } from '../../../lib/projectDocument.js';
import { emptySequence, addSequenceMedia, addSequenceClip } from '../../../app/veyrnox/_lib/editorSequence.mjs';
import { pickNativeProjectFile, shareNativeProjectFile } from '../src/lib/editorProjectFiles';
import type { ProjectDocument } from '../src/lib/editorBridge';

const mockPick = jest.fn(), mockShare = jest.fn(), mockAvailable = jest.fn(), mockRead = jest.fn(), mockInfo = jest.fn();
const mockCreate = jest.fn(), mockWrite = jest.fn(), mockDelete = jest.fn();
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: unknown[]) => mockPick(...args) }));
jest.mock('expo-sharing', () => ({ shareAsync: (...args: unknown[]) => mockShare(...args), isAvailableAsync: () => mockAvailable() }));
jest.mock('expo-file-system', () => ({ File: class {
    uri = 'file:///private/project.veyrnox.json'; exists = true; info = mockInfo; text = mockRead; create = mockCreate; write = mockWrite; delete = mockDelete;
} }));
jest.mock('../src/lib/appCache', () => ({ exportDirectory: () => ({ create: mockCreate }) }));

const id = '11111111-1111-4111-8111-111111111111';
function document() {
    let timeline = addSequenceMedia(emptySequence(), { id: 'local-source', kind: 'video', frames: 300, name: 'source.mp4', hasAudio: true, width: 1280, height: 720 });
    timeline = addSequenceClip(timeline, 'video', 'local-source', { in: 30, len: 120 } as any);
    return withTimeline(emptyProjectDocument(id), timeline) as ProjectDocument;
}
beforeEach(() => {
    jest.clearAllMocks(); mockAvailable.mockResolvedValue(true); mockShare.mockResolvedValue(undefined); mockInfo.mockReturnValue({ size: 100 });
    mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///pick/project.json', name: 'project.json', size: 100 }] });
    mockRead.mockResolvedValue(JSON.stringify(document()));
});
test('share writes a validated data-only Veyrnox project and opens the OS share sheet', async () => {
    await shareNativeProjectFile(document(), '../Launch film');
    expect(mockWrite).toHaveBeenCalledTimes(1);
    const body = String(mockWrite.mock.calls[0][0]);
    expect(JSON.parse(body)).toMatchObject({ schema_version: 3, project_id: id });
    expect(body).not.toMatch(/data:|blob:|base64|https:\/\//);
    expect(mockShare).toHaveBeenCalledWith('file:///private/project.veyrnox.json', { mimeType: 'application/json', UTI: 'public.json' });
});
test('pick preflights size, validates the whole document and deletes the private picker copy', async () => {
    const opened = await pickNativeProjectFile();
    expect(opened).toMatchObject({ sourceVersion: 3, timeline: { video: [{ len: 120 }] } });
    expect(mockPick).toHaveBeenCalledWith({ type: ['application/json', 'text/json', '*/*'], multiple: false, copyToCacheDirectory: true });
    expect(mockDelete).toHaveBeenCalledTimes(1);
    mockPick.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///pick/large.json', name: 'large.json', size: 32769 }] });
    expect(await pickNativeProjectFile()).toEqual({ refused: 'tooLarge' }); expect(mockRead).toHaveBeenCalledTimes(1);
    mockRead.mockResolvedValueOnce('{bad json'); expect(await pickNativeProjectFile()).toEqual({ refused: 'invalid' });
});
test('cancellation, stale work and unavailable sharing make no state change', async () => {
    mockPick.mockResolvedValueOnce({ canceled: true }); expect(await pickNativeProjectFile()).toBeNull();
    expect(await pickNativeProjectFile(() => false)).toBeNull();
    mockAvailable.mockResolvedValueOnce(false); expect(await shareNativeProjectFile(document(), 'Project')).toBe('unavailable');
    expect(mockWrite).not.toHaveBeenCalled();
});
