import { libraryMedia } from '../src/lib/editorLibraryLength';
import { probeDuration } from '../src/lib/editorMediaDuration';
import { exportSourceLink } from '../src/lib/editorServerExport';
jest.mock('../src/lib/editorMediaDuration', () => ({ probeDuration: jest.fn() }));
jest.mock('../src/lib/editorServerExport', () => ({ exportSourceLink: jest.fn() }));
const api = { request: jest.fn(), stream: jest.fn(), getBalance: jest.fn() };
const choice = { jobId: 'job', name: 'Shot' };
beforeEach(() => { jest.resetAllMocks(); });
test('video uses media-info seconds without storing links', async () => {
    api.request.mockResolvedValue({ seconds: 4.5 });
    expect(await libraryMedia(api, choice, 'video')).toEqual({ id: 'j-job', name: 'Shot', kind: 'video', frames: 135, hasAudio: true, width: 0, height: 0 });
    expect(api.request).toHaveBeenCalledWith('/api/v1/jobs/job/media-info'); expect(exportSourceLink).not.toHaveBeenCalled();
});
test.each(['video', 'audio'] as const)('%s falls back to a checked link and probe', async kind => {
    api.request.mockResolvedValue({}); jest.mocked(exportSourceLink).mockResolvedValue('https://example.com/media'); jest.mocked(probeDuration).mockResolvedValue(2.999);
    expect((await libraryMedia(api, choice, kind))?.frames).toBe(89);
    expect(probeDuration).toHaveBeenCalledWith('https://example.com/media');
    if (kind === 'audio') expect(api.request).not.toHaveBeenCalled();
});
test('image gets three seconds without any request', async () => {
    expect((await libraryMedia(api, choice, 'image'))?.frames).toBe(90); expect(api.request).not.toHaveBeenCalled(); expect(exportSourceLink).not.toHaveBeenCalled();
});
test('unknown and invalid durations fail closed', async () => {
    api.request.mockResolvedValue({}); jest.mocked(exportSourceLink).mockResolvedValue(null);
    expect(await libraryMedia(api, choice, 'video')).toBeNull();
    jest.mocked(exportSourceLink).mockResolvedValue('https://example.com/media');
    for (const value of [null, 0, -1, NaN, Infinity]) { jest.mocked(probeDuration).mockResolvedValue(value); expect(await libraryMedia(api, choice, 'audio')).toBeNull(); }
});
