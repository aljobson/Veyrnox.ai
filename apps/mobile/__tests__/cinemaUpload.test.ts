import { ApiError } from '../src/lib/api';
import type { TransferDeps } from '../src/lib/cinemaUpload';
import type { UploadRecord } from '../src/lib/cinemaUploadStore';
process.env.EXPO_PUBLIC_CINEMA_DEVICE_UPLOAD_ENABLED = 'true';
const { runTransfer, cleanupFor, startUpload, UPLOAD_CHUNK_BYTES: CHUNK } = require('../src/lib/cinemaUpload') as typeof import('../src/lib/cinemaUpload');
const ID = '11111111-1111-4111-8111-111111111111', UP = '22222222-2222-4222-8222-222222222222';
const PATH = `/cinema/uploads/${UP}/transfer?content_id=${ID}`;
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
function fixture(size = CHUNK * 2 + 7) {
    let offset = 0, alive = true, pause = false;
    const upload = { id: UP, content_id: ID, state: 'uploading', file_size: size, fingerprint: 'a'.repeat(64), transfer_path: PATH };
    const record: UploadRecord = { contentId: ID, uploadId: UP, size, fingerprint: upload.fingerprint, staged: `${UP}.mp4`, offset: 2, startKey: UP, pausedByUser: false };
    const request = jest.fn(async (_path: string, _init?: RequestInit): Promise<any> => _path.endsWith('/transfer?content_id=' + ID) ? { offset, length: size } : { upload, proxy_uploads_enabled: true });
    const stream = jest.fn(async (_path: string, init?: RequestInit) => { offset += (init?.body as Uint8Array).length; return response({ offset, length: size }); });
    const file = { offset: 0, readBytes: jest.fn(async (n: number) => new Uint8Array(n)) };
    const d: TransferDeps = { api: { request, stream }, record, file, live: () => alive, stopped: () => pause,
        save: jest.fn(async () => undefined), clear: jest.fn(async () => undefined), refresh: jest.fn(async () => undefined), sleep: jest.fn(async () => undefined) };
    return { d, upload, request, stream, file, setOffset: (n: number) => { offset = n; }, stop: () => { pause = true; }, stale: () => { alive = false; } };
}
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; };
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
test('exact binary parts and short last part with authenticated stream', async () => {
    const f = fixture(); expect(await runTransfer(f.d)).toBe('complete');
    expect(f.file.readBytes.mock.calls.map(c => c[0])).toEqual([CHUNK, CHUNK, 7]);
    expect(f.stream.mock.calls.map(c => c[1]?.headers)).toEqual([0, CHUNK, 2 * CHUNK].map(offset => ({ 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(offset) })));
    expect(f.d.refresh).toHaveBeenCalledTimes(1); expect(f.d.clear).toHaveBeenCalledTimes(1);
});
test('relaunch resumes from authoritative server offset, not saved progress', async () => {
    const f = fixture(); f.setOffset(CHUNK);
    await runTransfer(f.d); expect(f.stream.mock.calls[0][1]?.headers).toMatchObject({ 'Upload-Offset': String(CHUNK) });
    expect(f.file.readBytes).toHaveBeenCalledTimes(2);
});
test('fingerprint and transfer path mismatches stop before sending bytes', async () => {
    for (const bad of [{ fingerprint: 'b'.repeat(64) }, { transfer_path: 'https://evil.invalid/transfer' }, { transfer_path: PATH.replace(UP, ID) }]) {
        const f = fixture(); Object.assign(f.upload, bad);
        await expect(runTransfer(f.d)).rejects.toBeInstanceOf(ApiError); expect(f.stream).not.toHaveBeenCalled(); expect(f.d.clear).not.toHaveBeenCalled();
    }
});
test('pause waits for the in-flight part and saves its acknowledged offset', async () => {
    const f = fixture(), part = deferred<Response>(); f.stream.mockImplementationOnce(() => part.promise);
    const run = runTransfer(f.d); await settle(); f.stop(); part.resolve(response({ offset: CHUNK, length: f.d.record.size }));
    expect(await run).toBe('paused'); expect(f.stream).toHaveBeenCalledTimes(1);
    expect(f.d.save).toHaveBeenLastCalledWith(expect.objectContaining({ offset: CHUNK })); expect(f.d.clear).not.toHaveBeenCalled();
});
test('a PATCH completing after owner change cannot save or send another part', async () => {
    const f = fixture(), part = deferred<Response>(); f.stream.mockImplementationOnce(() => part.promise);
    const run = runTransfer(f.d); await settle(); (f.d.save as jest.Mock).mockClear(); f.stale();
    part.resolve(response({ offset: CHUNK, length: f.d.record.size })); expect(await run).toBe('stale');
    expect(f.d.save).not.toHaveBeenCalled(); expect(f.stream).toHaveBeenCalledTimes(1);
});
test('network failure backs off 2,4,8,16,30 seconds, re-reads offset, then pauses after six', async () => {
    const f = fixture(); f.stream.mockRejectedValue(new ApiError(0, 'network'));
    expect(await runTransfer(f.d)).toBe('paused'); expect(f.d.sleep).toHaveBeenNthCalledWith(1, 2000);
    expect((f.d.sleep as jest.Mock).mock.calls.flat()).toEqual([2000, 4000, 8000, 16000, 30000]);
    expect(f.request.mock.calls.filter(c => c[0] === '/api/v1' + PATH)).toHaveLength(6); expect(f.d.clear).not.toHaveBeenCalled();
});
test.each([[409, 'upload_offset_conflict', 0], [429, 'rate_limited', 60000]])('recovers %s %s', async (status, code, wait) => {
    const f = fixture(); f.stream.mockResolvedValueOnce(response({ error: code }, status));
    await runTransfer(f.d); if (wait) expect(f.d.sleep).toHaveBeenCalledWith(wait);
    else expect(f.request.mock.calls.filter(c => c[0] === '/api/v1' + PATH)).toHaveLength(2);
});
test('two consecutive invalid_body responses pause with slow-connection explanation', async () => {
    const f = fixture(); f.stream.mockResolvedValue(response({ error: 'invalid_body' }, 400));
    await expect(runTransfer(f.d)).rejects.toMatchObject({ code: 'slow_connection' }); expect(f.stream).toHaveBeenCalledTimes(2); expect(f.d.clear).not.toHaveBeenCalled();
});
test('not writable re-reads the expired upload', async () => {
    const f = fixture(); f.stream.mockImplementationOnce(async () => { f.upload.state = 'expired'; return response({ error: 'upload_not_writable' }, 409); });
    expect(await runTransfer(f.d)).toBe('status'); expect(f.d.clear).not.toHaveBeenCalled();
    expect(f.request.mock.calls.filter(c => c[0].startsWith('/api/v1/cinema/uploads?'))).toHaveLength(2);
});
test.each([[410, 'upload_removed', true], [409, 'upload_busy', false], [503, 'upload_needs_reconciliation', false], [503, 'upload_safety_hold', false], [503, 'uploads_not_open', false], [403, 'upload_not_allowed', false]])('stops %s %s, cleanup=%s', async (status, code, deletes) => {
    const f = fixture(); f.stream.mockResolvedValueOnce(response({ error: code }, status));
    await expect(runTransfer(f.d)).rejects.toMatchObject({ code }); expect(f.stream).toHaveBeenCalledTimes(1);
    expect(f.d.clear).toHaveBeenCalledTimes(deletes ? 1 : 0);
});
test('ambiguous start retries the same key, keeps the copy, and starts without a picker', async () => {
    const f = fixture(); f.d.record.uploadId = null; f.request.mockRejectedValueOnce(new ApiError(0, 'network'));
    await runTransfer(f.d);
    const starts = f.request.mock.calls.filter(c => c[1]?.method === 'POST'); expect(starts).toHaveLength(2);
    expect(starts[0][1]).toEqual(starts[1][1]); expect(starts[0][1]?.headers).toMatchObject({ 'Idempotency-Key': UP });
});
test('503 start keeps the record and key; idempotency conflict deletes it', async () => {
    for (const [status, code, count] of [[503, 'upload_safety_hold', 0], [409, 'idempotency_conflict', 1]] as const) {
        const f = fixture(); f.d.record.uploadId = null; f.request.mockRejectedValueOnce(new ApiError(status, code));
        await expect(runTransfer(f.d)).rejects.toMatchObject({ code }); expect(f.d.clear).toHaveBeenCalledTimes(count); expect(f.d.record.startKey).toBe(UP);
    }
});
test.each(['processing', 'ready', 'error', 'deleting'])('terminal read %s clears', async state => {
    const f = fixture(); f.upload.state = state; expect(await runTransfer(f.d)).toBe('status'); expect(f.d.clear).toHaveBeenCalled(); expect(f.stream).not.toHaveBeenCalled();
});
test('invalid offset and length fail closed', async () => {
    for (const answer of [{ offset: -1, length: 20 }, { offset: 21, length: 20 }, { offset: 0, length: 21 }]) {
        const f = fixture(20); f.request.mockImplementation(async () => answer as any);
        f.request.mockResolvedValueOnce({ upload: f.upload });
        await expect(runTransfer(f.d)).rejects.toMatchObject({ code: 'invalid_offset' }); expect(f.stream).not.toHaveBeenCalled();
    }
});
test('flag off refuses start and run before any I/O', async () => {
    process.env.EXPO_PUBLIC_CINEMA_DEVICE_UPLOAD_ENABLED = 'false';
    await jest.isolateModulesAsync(async () => {
        const disabled = require('../src/lib/cinemaUpload'); const f = fixture();
        await expect(disabled.runTransfer(f.d)).rejects.toMatchObject({ code: 'uploads_not_open' });
        await expect(disabled.startUpload(f.d.api, f.d.record)).rejects.toMatchObject({ code: 'uploads_not_open' });
        expect(f.request).not.toHaveBeenCalled(); expect(f.stream).not.toHaveBeenCalled();
    });
    process.env.EXPO_PUBLIC_CINEMA_DEVICE_UPLOAD_ENABLED = 'true';
});
const cleanupRows: Array<[string, string | { status: number; code: string }, string]> = [
    ...[0, 408, 429, 500, 503].map(status => ['start', { status, code: 'temporarily_unavailable' }, 'keep'] as [string, { status: number; code: string }, string]),
    ...['upload_needs_reconciliation', 'upload_safety_hold', 'uploads_not_open'].map(code => ['start', { status: 503, code }, 'keep'] as [string, { status: number; code: string }, string]),
    ['patch', { status: 400, code: 'invalid_body' }, 'keep'],
    ...['upload_offset_conflict', 'upload_busy', 'upload_not_writable'].map(code => ['patch', { status: 409, code }, 'keep'] as [string, { status: number; code: string }, string]),
    ...['pause', 'background', 'relaunch', 'same_owner_refresh'].map(x => ['user', x, 'keep'] as [string, string, string]),
    ['start', { status: 409, code: 'upload_exists' }, 'ask'], ['read', 'fingerprint_mismatch', 'ask'],
    ['start', { status: 409, code: 'idempotency_conflict' }, 'delete'], ['patch', { status: 410, code: 'upload_removed' }, 'delete'],
    ...['deleting', 'remove_accepted', 'processing', 'ready', 'error', 'last_part_confirmed', 'cancel_confirmed', 'owner_change', 'discard_confirmed'].map(x => ['user', x, 'delete'] as [string, string, string]),
    ['start', { status: 403, code: 'upload_not_allowed' }, 'keep'], ['patch', { status: 400, code: 'unknown' }, 'keep'],
];
test.each(cleanupRows)('cleanup table: %s %j => %s', (op, outcome, expected) => expect(cleanupFor(op, outcome)).toBe(expected));

test('unconfirmed or malformed PATCH acknowledgment never advances local progress', async () => {
    for (const body of [{ offset: 4, length: 10 }, { offset: 10, length: 11 }]) {
        const f = fixture(10); f.stream.mockResolvedValueOnce(response(body));
        await expect(runTransfer(f.d)).rejects.toMatchObject({ code: 'invalid_offset' });
        expect(f.d.save).toHaveBeenCalledTimes(1); expect(f.d.clear).not.toHaveBeenCalled();
    }
});
