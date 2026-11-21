import { ApiError, type ApiClient } from '../src/lib/api';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { resetNetworkState } from '../src/lib/network';
import { createExportFlow } from '../src/lib/music/exportFlow';
import { isExportUnavailable } from '../src/lib/music/exportAvailability';
import { shareStemFile } from '../src/lib/music/stemFiles';
import { quote, start, file, exportSong, response } from './fixtures/musicExport';
import { deferred, NEXT_VERSION_ID } from './fixtures/musicActions';
jest.mock('../src/lib/music/stemFiles', () => ({ shareStemFile: jest.fn(async () => {}) }));
const request = jest.fn(), api = { request } as unknown as ApiClient;
let flow: ReturnType<typeof createExportFlow>;
const starts = () => request.mock.calls.filter(([p]) => p.endsWith('/exports'));
const ready = async () => { await flow.load(); await flow.review(); await flow.confirm(); };
beforeEach(async () => {
    resetCacheUser(); await bindCacheUser('export-user'); resetNetworkState(); jest.clearAllMocks();
    request.mockReset().mockImplementation(response); flow = createExportFlow(api, exportSong.id, () => 'test-key');
});
afterEach(() => { flow.dispose(); resetCacheUser(); jest.restoreAllMocks(); });
test('review refreshes the current version and confirms only on explicit tap with one key', async () => {
    await flow.load(); request.mockResolvedValueOnce({ ...exportSong, version_id: NEXT_VERSION_ID });
    await flow.review(); expect(starts()).toHaveLength(0);
    expect(JSON.parse(request.mock.calls.find(([p]) => p.endsWith('/export-quotes'))![1].body).version_id).toBe(NEXT_VERSION_ID);
    const wait = deferred<typeof start>(); request.mockReturnValueOnce(wait.promise);
    const a = flow.confirm(), b = flow.confirm(); await Promise.resolve();
    expect(starts()).toHaveLength(1); wait.resolve(start); await Promise.all([a, b]);
    expect(JSON.parse(starts()[0][1].body)).toEqual({ quote_id: quote.id, idempotency_key: 'export.test-key' });
    expect(flow.snapshot()).toMatchObject({ status: 'ready', result: start, pending: null });
});
test('502 replay uses the same key even after expiry and refuses format/review/reload changes', async () => {
    await flow.load(); await flow.review(); request.mockRejectedValueOnce(new ApiError(502, 'temporarily_unavailable'));
    await flow.confirm(); expect(flow.snapshot().pending?.phase).toBe('AMBIGUOUS');
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(quote.expires_at) + 1);
    flow.edit('wav'); await flow.review(); await flow.load();
    expect(flow.snapshot().format).toBe('mp3');
    request.mockResolvedValueOnce({ ...start, idempotent: true }); await flow.confirm();
    expect(starts()).toHaveLength(2); expect(starts()[1][1].body).toBe(starts()[0][1].body);
    expect(flow.snapshot().status).toBe('ready');
});
test('only an unsubmitted quote is blocked by expiry', async () => {
    await flow.load(); await flow.review(); jest.spyOn(Date, 'now').mockReturnValue(Date.parse(quote.expires_at) + 1);
    await flow.confirm(); expect(starts()).toHaveLength(0); expect(flow.snapshot().error).toBe('quote_expired');
});
test('editing invalidates quotes and drops late reviews', async () => {
    await flow.load(); await flow.review(); flow.edit('wav'); expect(flow.snapshot().pending).toBeNull();
    const wait = deferred<{ quote: typeof quote }>(), begun = deferred<void>();
    request.mockResolvedValueOnce(exportSong).mockImplementationOnce(() => { begun.resolve(); return wait.promise; });
    const review = flow.review(); await begun.promise; flow.edit('flac'); wait.resolve({ quote: { ...quote, format: 'wav' } }); await review;
    expect(flow.snapshot()).toMatchObject({ format: 'flac', pending: null }); await flow.confirm(); expect(starts()).toHaveLength(0);
});
test.each(['quote', 'start'])('allowance exhaustion at %s remains a dedicated error', async stage => {
    await flow.load(); if (stage === 'start') await flow.review();
    if (stage === 'quote') request.mockResolvedValueOnce(exportSong);
    request.mockRejectedValueOnce(new ApiError(402, 'download_allowance_exhausted'));
    await (stage === 'quote' ? flow.review() : flow.confirm());
    expect(flow.snapshot()).toMatchObject({ error: 'download_allowance_exhausted', pending: null, result: null });
});
test.each([[409, 'render_required'], [503, 'format_unavailable'], [404, 'not_found'], [0, 'network']])('plain error retained for %s %s', async (status, code) => {
    await flow.load(); request.mockResolvedValueOnce(exportSong).mockRejectedValueOnce(new ApiError(Number(status), String(code)));
    await flow.review(); expect(flow.snapshot()).toMatchObject({ status: 'error', error: code });
});
test.each(['review', 'confirm', 'save'] as const)('distribution off at %s hides the entry', async method => {
    await flow.load();
    if (method !== 'review') await flow.review();
    if (method === 'save') await flow.confirm();
    if (method === 'review') request.mockResolvedValueOnce(exportSong);
    request.mockRejectedValueOnce(new ApiError(404, 'music_distribution_unavailable'));
    await flow[method](); expect(flow.snapshot().status).toBe('off'); expect(isExportUnavailable()).toBe(true);
});
test.each([{ ...exportSong, actions: [] }, { ...exportSong, lifecycle_status: 'trashed' }])('server eligibility is required', async song => {
    request.mockResolvedValue(song); await flow.load(); expect(flow.snapshot().status).toBe('off'); expect(starts()).toHaveLength(0);
});
test('failed transfer and dismissal keep the export; each Save re-reads and never posts', async () => {
    await ready(); request.mockClear();
    jest.mocked(shareStemFile).mockRejectedValueOnce(new ApiError(0, 'stem_share_failed'));
    for (let i = 0; i < 3; i++) {
        request.mockResolvedValueOnce({ export: { ...file, url: `https://signed.test/new-${i}` } });
        await flow.save(); expect(flow.snapshot().result?.export.id).toBe(start.export.id);
    }
    expect(request).toHaveBeenCalledTimes(3); expect(starts()).toHaveLength(0);
    expect(request.mock.calls.every(([p, init]) => p.endsWith(start.export.id) && init === undefined)).toBe(true);
    expect(jest.mocked(shareStemFile).mock.calls.map(([v]) => v.url)).toEqual([0, 1, 2].map(i => `https://signed.test/new-${i}`));
    expect(flow.snapshot()).toMatchObject({ status: 'ready', sheetClosed: true });
    expect(JSON.stringify(flow.snapshot())).not.toContain('signed.test');
});
test('double Save only reads and transfers once', async () => {
    await ready(); request.mockClear(); const wait = deferred<{ export: typeof file }>(); request.mockReturnValueOnce(wait.promise);
    const a = flow.save(), b = flow.save(); expect(request).toHaveBeenCalledTimes(1);
    wait.resolve({ export: file }); await Promise.all([a, b]); expect(shareStemFile).toHaveBeenCalledTimes(1);
});
test.each(['dispose', 'account'] as const)('%s drops late load, review, confirm and read results', async kind => {
    for (const phase of ['load', 'review', 'confirm', 'save'] as const) {
        flow.dispose(); flow = createExportFlow(api, exportSong.id);
        if (phase !== 'load') await flow.load();
        if (phase === 'confirm' || phase === 'save') await flow.review();
        if (phase === 'save') await flow.confirm();
        const wait = deferred<unknown>(); request.mockReturnValueOnce(wait.promise);
        const pending = flow[phase](); await Promise.resolve();
        if (kind === 'dispose') flow.dispose(); else await bindCacheUser(`next-${phase}`);
        wait.resolve(phase === 'load' || phase === 'review' ? exportSong : phase === 'confirm' ? start : { export: file }); await pending;
        expect(flow.isLive()).toBe(false); expect(flow.snapshot()).toMatchObject({ song: null, result: null, pending: null });
    }
    expect(shareStemFile).not.toHaveBeenCalled();
});
test('account change during native transfer invalidates its liveness callback', async () => {
    await ready(); const wait = deferred<void>(); jest.mocked(shareStemFile).mockReturnValueOnce(wait.promise);
    const pending = flow.save(); await Promise.resolve(); await Promise.resolve();
    const input = jest.mocked(shareStemFile).mock.calls[0][0]; expect(input.isCurrent()).toBe(true);
    await bindCacheUser('new-account'); expect(input.isCurrent()).toBe(false); wait.resolve(); await pending;
    expect(flow.snapshot().sheetClosed).toBe(false);
});
