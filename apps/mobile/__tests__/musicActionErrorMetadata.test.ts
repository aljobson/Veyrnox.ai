import { ApiError, type ApiClient } from '../src/lib/api';
import { actionErrorMetadata } from '../src/lib/music/actionErrorMetadata';
import { createSongActionFlow } from '../src/lib/music/actionFlow';
import { replaceAction } from '../src/lib/music/replaceAction';
import { sectionSong, replaceQuote, replaceParameters } from './fixtures/musicSectionActions';
import { SONG_ID } from './fixtures/musicActions';
test('only finite nonnegative duration metadata is retained', () => {
    expect(actionErrorMetadata(new ApiError(400, 'range_invalid', { source_duration_seconds: 0, max_duration_seconds: 60, lyrics: 'private', other: {} })))
        .toEqual({ source_duration_seconds: 0, max_duration_seconds: 60 });
    for (const value of [-1, NaN, Infinity, '3', null, {}]) expect(actionErrorMetadata(new ApiError(400, 'range_invalid', { source_duration_seconds: value, max_duration_seconds: value }))).toBeNull();
    expect(actionErrorMetadata(new Error('offline'))).toBeNull();
});
test('metadata clears on edit, review (including missing rights), reload and disposal', async () => {
    const request = jest.fn(async (path: string) => path.endsWith('/replace-quotes') ? replaceQuote : sectionSong);
    const flow = createSongActionFlow({ request } as unknown as ApiClient, replaceAction(SONG_ID), SONG_ID);
    await flow.load();
    const fail = () => flow.fail(new ApiError(400, 'range_invalid', { source_duration_seconds: 3 }));
    fail(); flow.edit({ parameters: replaceParameters }); expect(flow.snapshot().errorMetadata).toBeNull();
    fail(); await flow.review(); expect(flow.snapshot().errorMetadata).toBeNull();
    flow.edit({ rights_confirmed: true }); fail(); await flow.review(); expect(flow.snapshot().errorMetadata).toBeNull();
    fail(); await flow.load(); expect(flow.snapshot().errorMetadata).toBeNull();
    fail(); flow.dispose(); expect(flow.snapshot().errorMetadata).toBeNull();
});
