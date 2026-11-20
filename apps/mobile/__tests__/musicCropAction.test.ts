import { ApiError, type ApiClient } from '../src/lib/api';
import { resetCacheUser } from '../src/lib/appCache';
import { createCropAction, cropRangeError } from '../src/lib/music/cropAction';
import { subscribeSongChanges } from '../src/lib/music/songChanges';
import { actionSong, croppedSong, cropResult, SONG_ID, VERSION_ID, NEXT_VERSION_ID, deferred } from './fixtures/musicActions';
let request: jest.Mock, flow: ReturnType<typeof createCropAction>, mint: jest.Mock;
const posts = () => request.mock.calls.filter(([p]) => p.endsWith('/crop'));
beforeEach(async () => {
    request = jest.fn().mockResolvedValue(actionSong); let ordinal = 0; mint = jest.fn(() => `key-12345678-${++ordinal}`);
    flow = createCropAction({ request } as unknown as ApiClient, SONG_ID, mint); await flow.load(); flow.edit({ start: '0.1', end: '5.2' });
});
afterEach(() => flow.dispose());
test.each([
    ['0', '0.9', null, 'crop_too_short'], ['-1', '5', null, 'crop_range_invalid'], ['NaN', '5', null, 'crop_range_invalid'],
    ['0', 'Infinity', null, 'crop_range_invalid'], ['', '5', null, 'crop_range_invalid'], ['0', '', null, 'crop_range_invalid'],
    ['5', '5', null, 'crop_range_invalid'], ['0', '86401', null, 'crop_range_invalid'], ['0', '10.1', 10, 'crop_range_invalid'],
    ['0.1', '1.1', 10, null], ['0', '10.04', 10, null], ['0', '10', null, null],
] as const)('range %s..%s, duration %s => %s', (start, end, duration, expected) => expect(cropRangeError(start, end, duration)).toBe(expected));
const FIRST_ATTEMPT = ['crop', 'key-12345678-1'].join('.');
test('invalid range blocks POST and duration is accepted only from the current audio', async () => {
    flow.setDuration(3, NEXT_VERSION_ID); expect(flow.snapshot().duration).toBeNull();
    flow.setDuration(NaN, VERSION_ID); expect(flow.snapshot().duration).toBeNull();
    flow.setDuration(3, VERSION_ID); await flow.confirm(); expect(posts()).toHaveLength(0); expect(flow.snapshot().error).toBe('crop_range_invalid');
    flow.edit({ end: '0.5' }); await flow.confirm(); expect(posts()).toHaveLength(0); expect(flow.snapshot().error).toBe('crop_too_short');
});
test('success refreshes versions and notifies library; duplicate confirm creates one version', async () => {
    const changed = jest.fn(), stop = subscribeSongChanges(changed); const wait = deferred<typeof cropResult>();
    request.mockImplementation(p => p.endsWith('/crop') ? wait.promise : croppedSong);
    const a = flow.confirm(), b = flow.confirm(); expect(posts()).toHaveLength(1); wait.resolve(cropResult); await Promise.all([a, b]);
    expect(JSON.parse(posts()[0][1].body)).toEqual({ version_id: VERSION_ID, start_seconds: 0.1, end_seconds: 5.2, idempotency_key: FIRST_ATTEMPT });
    expect(changed).toHaveBeenCalledTimes(1); expect(flow.snapshot().song?.versions).toEqual(croppedSong.versions);
    expect(flow.snapshot().result).toEqual(cropResult); expect(request.mock.calls.at(-1)?.[0]).toBe(`/api/v1/music/songs/${SONG_ID}`);
    await flow.confirm(); expect(posts()).toHaveLength(1); stop();
});
test('lost acknowledgement reuses key; editing the range creates a new attempt', async () => {
    request.mockRejectedValueOnce(new ApiError(502, 'temporarily_unavailable')); await flow.confirm();
    expect(flow.snapshot().ambiguous).toBe(true); const body = JSON.parse(posts()[0][1].body);
    request.mockRejectedValueOnce(new ApiError(502, 'temporarily_unavailable')); await flow.confirm();
    expect(JSON.parse(posts()[1][1].body)).toEqual(body); expect(mint).toHaveBeenCalledTimes(1);
    flow.edit({ end: '6.2' }); request.mockResolvedValueOnce(cropResult).mockResolvedValueOnce(croppedSong); await flow.confirm();
    expect(JSON.parse(posts()[2][1].body).idempotency_key).not.toBe(body.idempotency_key); expect(mint).toHaveBeenCalledTimes(2);
});
test('server range error supplies duration and keeps the same key until an edit', async () => {
    request.mockRejectedValueOnce(new ApiError(400, 'crop_range_invalid', { duration_seconds: 3 })); await flow.confirm();
    expect(flow.snapshot()).toMatchObject({ duration: 3, error: 'crop_range_invalid', ambiguous: false });
    request.mockRejectedValueOnce(new ApiError(400, 'crop_range_invalid', { duration_seconds: 3 })); await flow.confirm();
    expect(mint).toHaveBeenCalledTimes(1); expect(JSON.parse(posts()[1][1].body)).toEqual(JSON.parse(posts()[0][1].body));
});
test('refresh failure preserves acknowledged success and cannot resubmit', async () => {
    request.mockResolvedValueOnce(cropResult).mockRejectedValueOnce(new ApiError(502, 'temporarily_unavailable')); await flow.confirm();
    expect(flow.snapshot().result).toEqual(cropResult); expect(flow.snapshot().ambiguous).toBe(false);
    await flow.confirm(); expect(posts()).toHaveLength(1);
    request.mockResolvedValueOnce(croppedSong); await flow.load(); expect(flow.snapshot().song).toEqual(croppedSong);
});
test.each(['source_changed', 'revision_conflict'])('%s can reload the current source', async code => {
    request.mockRejectedValueOnce(new ApiError(409, code)); await flow.confirm(); expect(flow.snapshot().error).toBe(code);
    request.mockResolvedValueOnce(croppedSong); await flow.load(); expect(flow.snapshot().song?.version_id).toBe(NEXT_VERSION_ID);
});
test.each(['load', 'confirm'])('%s unavailable maps to off', async stage => {
    request.mockRejectedValueOnce(new ApiError(404, 'music_editing_unavailable'));
    if (stage === 'load') await flow.load(); else await flow.confirm();
    expect(flow.snapshot().status).toBe('off'); expect(flow.snapshot().song).toBeNull();
});
test.each([{ ...actionSong, actions: [] }, { ...actionSong, lifecycle_status: 'trashed' }])('server gating prevents crop', async song => {
    request.mockResolvedValueOnce(song); await flow.load(); await flow.confirm(); expect(flow.snapshot().status).toBe('off'); expect(posts()).toHaveLength(0);
});
test.each(['dispose', 'account'])('%s clears crop state and ignores late success', async reason => {
    const wait = deferred<typeof cropResult>(); request.mockReturnValueOnce(wait.promise); const confirm = flow.confirm();
    if (reason === 'dispose') flow.dispose(); else resetCacheUser(); wait.resolve(cropResult); await confirm;
    expect(flow.snapshot().song).toBeNull(); expect(flow.snapshot().result).toBeNull(); expect(request).toHaveBeenCalledTimes(2);
});

test.each([['0,5', '2,5', 0.5, 2.5], ['1,5', '3', 1.5, 3]])('a decimal comma %s..%s is sent as %s..%s', async (start, end, a, b) => {
    expect(cropRangeError(start, end, null)).toBeNull();
    flow.edit({ start, end }); await flow.confirm();
    expect(JSON.parse(posts()[0][1].body)).toMatchObject({ start_seconds: a, end_seconds: b });
});
test.each([['1,2,3', '5'], ['1.5,', '5'], ['a,b', '5']])('malformed comma input %s..%s stays invalid', (start, end) => {
    expect(cropRangeError(start, end, null)).toBe('crop_range_invalid');
});
