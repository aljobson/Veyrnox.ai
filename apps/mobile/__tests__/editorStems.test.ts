import { libraryStems, stemMedia } from '../src/lib/editorStems';
import { probeDuration } from '../src/lib/editorMediaDuration';
import type { ApiClient } from '../src/lib/api';
import { t } from '../src/lib/i18n';
jest.mock('../src/lib/editorMediaDuration', () => ({ probeDuration: jest.fn() }));
const request = jest.fn(), api = { request } as unknown as ApiClient;
const id = '11111111-1111-1111-1111-111111111111';
beforeEach(() => { request.mockReset().mockResolvedValue({ url: 'https://example.com/audio.wav', mime_type: 'audio/wav' }); jest.mocked(probeDuration).mockReset().mockResolvedValue(2.25); });
test('libraryStems keeps known labels in STEMS order and ignores unknown ones', async () => {
    request.mockResolvedValueOnce({ output_stems: ['piano', 'unknown', 'bass', 'vocals', 'vocals'] });
    expect(await libraryStems(api, id)).toEqual(['vocals', 'bass', 'piano']);
});
test('missing stems and asset errors return an empty list', async () => {
    expect(await libraryStems(api, id)).toEqual([]);
    request.mockRejectedValueOnce(new Error('offline')); expect(await libraryStems(api, id)).toEqual([]);
});
test('stemMedia names the media, uses the web id and requests the encoded stem', async () => {
    expect(await stemMedia(api, id, 'Song', 'vocals')).toEqual({ id: `j-${id}--vocals`, name: t('editorAi.stemName', { name: 'Song', stem: t('stem.vocals') }), kind: 'audio', frames: 67, hasAudio: true, width: 0, height: 0 });
    expect(request).toHaveBeenCalledWith(`/api/v1/jobs/${id}/asset?stem=vocals`);
});
test.each([{ url: 'http://example.com/a', mime_type: 'audio/wav' }, { url: 'https://example.com/a', mime_type: 'video/mp4' }])('rejects unsafe or non-audio assets %j', async asset => {
    request.mockResolvedValueOnce(asset); expect(await stemMedia(api, id, 'Song', 'vocals')).toBeNull(); expect(probeDuration).not.toHaveBeenCalled();
});
test.each([null, 0, NaN, -1])('unknown or invalid length %s returns null', async seconds => {
    jest.mocked(probeDuration).mockResolvedValueOnce(seconds); expect(await stemMedia(api, id, 'Song', 'vocals')).toBeNull();
});
