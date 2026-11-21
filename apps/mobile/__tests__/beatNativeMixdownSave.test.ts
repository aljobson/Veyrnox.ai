import { ApiError, type ApiClient } from '../src/lib/api';
import { createMixdownSaver, MIXDOWN_MAX_BYTES, mixdownErrorKey, probeMixdownSave, type MixdownTask } from '../src/lib/beatNative/mixdownSave';
import { addAudioRegion, resizeRegion } from '../src/lib/beatNative/doc';
import { takeAsset } from '../src/lib/beatNative/takeShared';
import { deferred, fixedDoc, tick, USER, PROJECT, VERSION } from './beatNativeFixtures';
import { uploadFixture } from './beatNativeUploadFixture';
import { MIXDOWN_UPLOAD_STALL_MS } from '../src/lib/beatNative/mixdownUpload';
import { takeRow } from './beatNativeTakeFixtures';
let mockKey = 0;
jest.mock('expo-crypto', () => ({ ...jest.requireActual('expo-crypto'), randomUUID: () => `00000000-0000-4000-8000-${String(++mockKey).padStart(12, '0')}` }));
const done = { song_id: PROJECT, version_id: VERSION, committed: true };
const reservation = { ...done, committed: false, upload_url: 'https://bucket.r2.cloudflarestorage.com/mix.wav', headers: { 'content-type': 'audio/wav', 'if-none-match': '*', Authorization: 'never-forward', Cookie: 'never-forward', 'Content-Length': '48' } };
function setup() {
    let live = true;
    const controller = new AbortController(), task: MixdownTask = { gen: 1, user: USER, current: () => live, signal: controller.signal };
    const request = jest.fn().mockResolvedValueOnce(reservation).mockResolvedValue(done), api = { request } as unknown as ApiClient;
    const upload = uploadFixture(), hash = jest.fn(async () => new Uint8Array(32).buffer);
    const saver = createMixdownSaver(api, upload.makeRequest, hash);
    const options = { doc: fixedDoc(), range: 'song' as const, title: ' Ｍｉｘ ', rights: false, task, render: jest.fn(async () => new ArrayBuffer(48)) };
    return { task, request, api, upload, hash, saver, options, controller, change: () => { live = false; } };
}
test.each([
    [404, 'beat_library_save_unavailable', 'off'], [400, 'invalid_inputs', 'on'], [401, 'not_authenticated', 'signedOut'],
    [404, 'other', 'error'], [503, 'service_unavailable', 'error'], [0, 'network', 'offline'],
])('probe maps %s/%s to %s with a side-effect-free empty body', async (status, code, expected) => {
    const s = setup(); s.request.mockReset().mockRejectedValue(new ApiError(Number(status), String(code)));
    expect(await probeMixdownSave(s.api, s.task)).toBe(expected);
    expect(JSON.parse(s.request.mock.calls[0][1].body)).toEqual({});
});
test('reserve → filtered anonymous PUT → commit uses the same owner/task, hash and NFKC title', async () => {
    const s = setup(), progress = jest.fn();
    expect(await s.saver.save({ ...s.options, progress })).toEqual(done);
    expect(JSON.parse(s.request.mock.calls[0][1].body)).toMatchObject({ action: 'reserve', title: 'Mix', size_bytes: 48, sha256: '00'.repeat(32), duration_seconds: 4 / (48000 * 4), sources: [], has_takes: false, rights_confirmed: false });
    const xhr = s.upload.requests[0];
    expect(xhr.open).toHaveBeenCalledWith('PUT', reservation.upload_url, true); expect(xhr.withCredentials).toBe(false);
    expect(xhr.setRequestHeader.mock.calls).toEqual([['content-type', 'audio/wav'], ['if-none-match', '*']]);
    expect(xhr.send).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    const reserve = JSON.parse(s.request.mock.calls[0][1].body), commit = JSON.parse(s.request.mock.calls[1][1].body);
    expect(commit).toEqual({ action: 'commit', idempotency_key: reserve.idempotency_key, version_id: VERSION });
    for (const call of s.request.mock.calls) expect(call[2]).toEqual({ owner: USER, task: s.task });
    expect(progress.mock.calls).toEqual([['reserve'], ['upload', 0], ['upload', 100], ['commit']]);
});
test('committed reservation short-circuits and PUT 412 is a successful retry', async () => {
    const s = setup(); s.request.mockReset().mockResolvedValue(done);
    await s.saver.save(s.options); expect(s.upload.makeRequest).not.toHaveBeenCalled(); expect(s.request).toHaveBeenCalledTimes(1);
    s.request.mockReset().mockResolvedValueOnce(reservation).mockResolvedValue(done); s.upload.status(412);
    await expect(s.saver.save(s.options)).resolves.toEqual(done);
});
test('size cap and take rights fail before reservation; invalid title fails before render', async () => {
    const s = setup(); s.options.render.mockResolvedValue(new ArrayBuffer(MIXDOWN_MAX_BYTES + 1));
    await expect(s.saver.save(s.options)).rejects.toMatchObject({ code: 'mixdown_size_invalid' }); expect(s.hash).not.toHaveBeenCalled(); expect(s.request).not.toHaveBeenCalled();
    const doc = addAudioRegion(fixedDoc(), takeAsset(takeRow()), null, 0);
    await expect(s.saver.save({ ...s.options, doc })).rejects.toMatchObject({ code: 'rights_required' });
    s.options.render.mockClear(); await expect(s.saver.save({ ...s.options, title: ' '.repeat(10) })).rejects.toMatchObject({ code: 'title_invalid' }); expect(s.options.render).not.toHaveBeenCalled();
});
test.each(['https://evil.test/upload', 'https://bucket.r2.cloudflarestorage.com.evil.test/a', 'https://user:pass@bucket.r2.cloudflarestorage.com/a'])('invalid upload URL %s is never fetched', async upload_url => {
    const s = setup(); s.request.mockReset().mockResolvedValue({ ...reservation, upload_url });
    await expect(s.saver.save(s.options)).rejects.toMatchObject({ code: 'bad_response' }); expect(s.upload.makeRequest).not.toHaveBeenCalled();
});
test('account changes while reserve is delayed: no PUT, no commit and no success', async () => {
    const s = setup(), gate = deferred<unknown>(); s.request.mockReset().mockReturnValue(gate.promise);
    const saving = s.saver.save(s.options), rejected = expect(saving).rejects.toMatchObject({ status: 401 });
    await tick(); expect(s.request).toHaveBeenCalledTimes(1);
    s.change(); s.controller.abort(); gate.resolve(reservation); await rejected;
    expect(s.upload.makeRequest).not.toHaveBeenCalled(); expect(s.request).toHaveBeenCalledTimes(1);
});
test.each(['render', 'hash', 'put'])('session change after %s fences the following operation', async phase => {
    const s = setup();
    if (phase === 'render') s.options.render.mockImplementation(async () => { s.change(); return new ArrayBuffer(48); });
    if (phase === 'hash') s.hash.mockImplementation(async () => { s.change(); return new ArrayBuffer(32); });
    if (phase === 'put') {
        const make = s.upload.makeRequest.getMockImplementation()!;
        s.upload.makeRequest.mockImplementation(() => { const xhr = make(); s.change(); return xhr; });
    }
    await expect(s.saver.save(s.options)).rejects.toMatchObject({ status: 401 });
    expect(s.request).toHaveBeenCalledTimes(phase === 'put' ? 1 : 0);
});
test.each(['reservation_closed', 'reservation_expired', 'idempotency_conflict'])('%s drops the attempt; ordinary failure reuses its key', async code => {
    const s = setup(); s.request.mockReset().mockRejectedValue(new ApiError(503, 'service_unavailable'));
    await expect(s.saver.save(s.options)).rejects.toBeInstanceOf(ApiError);
    await expect(s.saver.save(s.options)).rejects.toBeInstanceOf(ApiError);
    const key = (i: number) => JSON.parse(s.request.mock.calls[i][1].body).idempotency_key;
    expect(key(0)).toBe(key(1));
    s.request.mockRejectedValue(new ApiError(409, code)); await expect(s.saver.save(s.options)).rejects.toBeInstanceOf(ApiError);
    s.request.mockResolvedValue(done); await s.saver.save(s.options); expect(key(3)).not.toBe(key(2));
    await s.saver.save({ ...s.options, title: 'Another' }); expect(key(4)).not.toBe(key(3));
    s.saver.drop(); await s.saver.save({ ...s.options, title: 'Another' }); expect(key(5)).not.toBe(key(4));
});
test.each(['mixdown_size_invalid', 'source_unavailable', 'account_frozen', 'rights_required', 'rights_confirmation_required', 'reservation_closed', 'reservation_expired', 'idempotency_conflict', 'rate_limited'])('route code %s maps to owned copy, never server text', code => {
    expect(mixdownErrorKey(new ApiError(400, 'bad_request', { error: { code, message: 'private server detail' } }))).toMatch(/^beatExport\./);
    expect(mixdownErrorKey(new ApiError(400, code))).not.toBe('beatExport.saveError');
});

test('N7-R3: save preflight rejects a large planned mix before invoking its renderer', async () => {
    const s = setup(), doc = resizeRegion(s.options.doc, s.options.doc.tracks[0].regions[0].id, 80 * 3840);
    await expect(s.saver.save({ ...s.options, doc })).rejects.toMatchObject({ code: 'mixdown_size_invalid' });
    expect(s.options.render).not.toHaveBeenCalled(); expect(s.hash).not.toHaveBeenCalled(); expect(s.request).not.toHaveBeenCalled();
});

const attemptKey = (request: jest.Mock, index: number) => JSON.parse(request.mock.calls[index][1].body).idempotency_key;
test('N7-RV-002: a stalled upload aborts after 60 seconds and retry keeps the attempt key', async () => {
    jest.useFakeTimers();
    try {
        const s = setup(); s.upload.hold();
        const result = s.saver.save(s.options), rejected = expect(result).rejects.toMatchObject({ status: 0, code: 'network_error' });
        await jest.advanceTimersByTimeAsync(0);
        expect(s.upload.requests).toHaveLength(1);
        await jest.advanceTimersByTimeAsync(MIXDOWN_UPLOAD_STALL_MS - 1);
        expect(s.upload.requests[0].abort).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1); await rejected;
        expect(s.upload.requests[0].abort).toHaveBeenCalledTimes(1); expect(s.request).toHaveBeenCalledTimes(1);
        expect(mixdownErrorKey(new ApiError(0, 'network_error'))).toBe('beatExport.offline');
        await s.saver.save(s.options); expect(attemptKey(s.request, 1)).toBe(attemptKey(s.request, 0));
        expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
});
test('N7-RV-002: real upload progress updates percent and only advancing bytes extend the stall deadline', async () => {
    jest.useFakeTimers();
    try {
        const s = setup(), progress = jest.fn(); s.upload.hold();
        const saving = s.saver.save({ ...s.options, progress });
        await jest.advanceTimersByTimeAsync(0);
        await jest.advanceTimersByTimeAsync(50_000); s.upload.progress(25);
        expect(progress).toHaveBeenLastCalledWith('upload', 25);
        await jest.advanceTimersByTimeAsync(50_000); s.upload.progress(75);
        expect(progress).toHaveBeenLastCalledWith('upload', 75);
        expect(s.upload.requests[0].abort).not.toHaveBeenCalled();
        s.upload.complete(); await saving;
        expect(progress).toHaveBeenLastCalledWith('commit'); expect(jest.getTimerCount()).toBe(0);
        s.request.mockResolvedValueOnce(reservation); const again = s.saver.save(s.options);
        const rejected = expect(again).rejects.toMatchObject({ status: 0 });
        await jest.advanceTimersByTimeAsync(0);
        s.upload.progress(10); await jest.advanceTimersByTimeAsync(50_000); s.upload.progress(10);
        await jest.advanceTimersByTimeAsync(10_000); await rejected;
    } finally { jest.useRealTimers(); }
});
test('N7-RV-002: a session abort stops the active XHR, prevents commit and drops the attempt key', async () => {
    const s = setup(); s.upload.hold();
    const saving = s.saver.save(s.options), rejected = expect(saving).rejects.toMatchObject({ status: 401 });
    await tick(); s.change(); s.controller.abort(); await rejected;
    expect(s.upload.requests[0].abort).toHaveBeenCalledTimes(1); expect(s.request).toHaveBeenCalledTimes(1);
    const freshTask = { ...s.task, current: () => true, signal: new AbortController().signal };
    await s.saver.save({ ...s.options, task: freshTask });
    expect(attemptKey(s.request, 1)).not.toBe(attemptKey(s.request, 0));
});
