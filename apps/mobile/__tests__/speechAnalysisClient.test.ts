import { ApiError, type ApiClient } from '../src/lib/api';
import { t } from '../src/lib/i18n';
import { fetchSpeechQuote, startSpeech, pollSpeech, speechKeyFor, forgetSpeechKey, SPEECH_PATH, speechMessage } from '../src/lib/speechAnalysis';
import { resetNetworkState, markOffline } from '../src/lib/networkState';
import { OFFLINE_PAID_MESSAGE } from '../src/lib/network';
import { isPaidAction } from '../src/lib/hardPaywall';
import { sendsContent } from '../src/lib/aiConsent';
let mockOwner = 'owner';
var mockListeners: Set<() => void>;
jest.mock('../src/lib/appCache', () => {
    mockListeners = new Set<() => void>();
    return { getCacheUser: () => mockOwner, subscribeCacheUser: (fn: () => void) => { mockListeners.add(fn); return () => mockListeners.delete(fn); } };
});
const api = (request: jest.Mock) => ({ request }) as unknown as ApiClient;
const args = () => ({ account: mockOwner, jobId: '33333333-3333-4333-8333-333333333333', duration: 12, key: 'speech-key', credits: 7 });
beforeEach(() => { mockOwner = 'owner'; resetNetworkState(); });
afterEach(() => { mockListeners.forEach(fn => fn()); jest.useRealTimers(); });
test('quote and 501 availability; exact discriminated source, quoted price, owner, no long deadline', async () => {
    const request = jest.fn().mockResolvedValueOnce({ credits: 7, max_seconds: 60, languages: ['en'] }).mockResolvedValueOnce({ id: 'job', status: 'queued' }).mockRejectedValueOnce(new ApiError(501, 'speech_cut_unavailable'));
    expect((await fetchSpeechQuote(api(request)))?.credits).toBe(7); await startSpeech(api(request), args());
    const [path, init, opts] = request.mock.calls[1]; expect(path).toBe(SPEECH_PATH); expect(opts).toEqual({ owner: 'owner' });
    expect(JSON.parse(init.body)).toEqual({ source: { type: 'job', jobId: args().jobId }, duration: 12, expectedCredits: 7, idempotencyKey: 'speech-key' });
    expect(await fetchSpeechQuote(api(request))).toBeNull();
});
test('offline never POSTs or recovers; consent and paywall gate only paid POST', async () => {
    markOffline(); const request = jest.fn(); const error = await startSpeech(api(request), args()).catch(e => e); expect(speechMessage(error)).toBe(OFFLINE_PAID_MESSAGE); expect(request).not.toHaveBeenCalled();
    expect(isPaidAction(SPEECH_PATH, 'POST')).toBe(true); expect(sendsContent(SPEECH_PATH, 'POST')).toBe(true);
    for (const suffix of ['/quote', '/by-key/key', '/id']) { expect(isPaidAction(SPEECH_PATH + suffix, 'GET')).toBe(false); expect(sendsContent(SPEECH_PATH + suffix, 'GET')).toBe(false); }
});
test('lost reply recovers by key without another POST; confirmed refund remains explicit', async () => {
    const request = jest.fn().mockRejectedValueOnce(new ApiError(0, 'network')).mockResolvedValueOnce({ id: 'job', status: 'queued' });
    expect((await startSpeech(api(request), args())).status).toBe('queued'); expect(request.mock.calls[1][0]).toBe(`${SPEECH_PATH}/by-key/speech-key`); expect(request).toHaveBeenCalledTimes(2);
    request.mockReset().mockRejectedValue(new ApiError(502, 'provider_rejected', { refunded: true }));
    await expect(startSpeech(api(request), args())).rejects.toMatchObject({ body: { refunded: true } }); expect(request).toHaveBeenCalledTimes(1);
});
test('keys are stable per account/source/duration; refund forget and account change clear memory', () => {
    const make = jest.fn().mockReturnValueOnce('one').mockReturnValueOnce('two').mockReturnValueOnce('three');
    expect(speechKeyFor('owner', 'source', 12, make)).toBe('one'); expect(speechKeyFor('owner', 'source', 12, make)).toBe('one');
    forgetSpeechKey('owner', 'source'); expect(speechKeyFor('owner', 'source', 12, make)).toBe('two');
    mockOwner = 'other'; mockListeners.forEach(fn => fn()); expect(speechKeyFor('owner', 'source', 12, make)).toBe('three');
});
test('backoff publishes progress and stops at three minutes without leaking timers', async () => {
    jest.useFakeTimers(); const request = jest.fn().mockResolvedValue({ id: 'job', status: 'queued', progress: 'transcribing' }), progress = jest.fn();
    const pending = pollSpeech(api(request), 'key', 'owner', new AbortController().signal, progress);
    const check = expect(pending).rejects.toMatchObject({ code: 'poll_timeout' }); await jest.advanceTimersByTimeAsync(180000); await check;
    expect(progress).toHaveBeenCalledWith('transcribing'); expect(request.mock.calls.length).toBeGreaterThan(10); expect(request.mock.calls.length).toBeLessThan(30); expect(jest.getTimerCount()).toBe(0);
});
test.each(['unmount', 'account'])('%s aborts an in-flight read and clears timers', async reason => {
    jest.useFakeTimers(); const request = jest.fn((_path: string, _init: RequestInit) => new Promise(() => {})), controller = new AbortController();
    const pending = pollSpeech(api(request), 'key', 'owner', controller.signal, jest.fn()); const check = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    if (reason === 'account') { mockOwner = 'other'; mockListeners.forEach(fn => fn()); } else controller.abort();
    await check; expect(jest.getTimerCount()).toBe(0); expect(request.mock.calls[0][1].signal?.aborted).toBe(true);
});
test('account change while read resolves cannot release the previous account analysis', async () => {
    let resolve!: (v: unknown) => void; const request = jest.fn(() => new Promise(r => { resolve = r; }));
    const pending = pollSpeech(api(request), 'key', 'owner', new AbortController().signal, jest.fn()); const check = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    mockOwner = 'other'; mockListeners.forEach(fn => fn()); resolve({ status: 'failed', refunded: true }); await check;
});

test('a server source_unsupported says why the file was refused, not that the clip is unavailable', () => {
    const message = speechMessage(new ApiError(400, 'source_unsupported'));
    expect(message).toBe(t('editorSpeech.sourceRejected'));
    expect(message).not.toBe(t('editorSpeech.unsupported'));
});
describe('a refused source names its real reason', () => {
    test('too large shows the size and the limit', () => {
        const message = speechMessage(new ApiError(400, 'source_too_large', { size_mb: 120.5, max_mb: 100 }));
        expect(message).toBe(t('editorSpeech.sourceTooLarge', { size: '120.5', max: '100' }));
        expect(message).toContain('120.5'); expect(message).toContain('100'); expect(message).not.toBe(t('editorSpeech.sourceRejected'));
    });
    test('too many bytes per second shows size and length, not the 100 MB limit', () => {
        const message = speechMessage(new ApiError(400, 'source_bitrate_too_high', { size_mb: 25, seconds: 12 }));
        expect(message).toBe(t('editorSpeech.sourceDense', { size: '25', seconds: '12' }));
        expect(message).toContain('25'); expect(message).toContain('12'); expect(message).not.toContain('100 MB');
    });
    test('unreadable format says the file could not be read', () => {
        const message = speechMessage(new ApiError(400, 'source_unreadable', { reason: 'probe_failed' }));
        expect(message).toBe(t('editorSpeech.sourceUnreadable')); expect(message).not.toContain('100 MB');
    });
    test.each([['fragmented', 'editorSpeech.sourceFragmented'], ['no_hash', 'editorSpeech.sourceNoHash'], ['unsupported_type', 'editorSpeech.sourceBadType'], ['read_failed', 'editorSpeech.sourceUnreadable'], ['movie_box_too_large', 'editorSpeech.sourceUnreadable']])(
        'an unreadable clip names its reason: %s', (reason, key) => {
            const message = speechMessage(new ApiError(400, 'source_unreadable', { reason }));
            expect(message).toBe(t(key)); expect(message).not.toMatch(/save[d]? as MP4 or MOV/i);
        });
    test('a video with no sound says so, and is not the generic or the no-speech-refund text', () => {
        const message = speechMessage(new ApiError(400, 'source_no_audio'));
        expect(message).toBe(t('editorSpeech.sourceNoAudio')); expect(message).toMatch(/sound|audio/i);
        expect(message).not.toBe(t('editorSpeech.sourceRejected')); expect(message).not.toBe(t('bestCut.noSpeech'));
    });
    test('a clip longer than a minute says so, not a file problem', () => {
        expect(speechMessage(new ApiError(400, 'source_too_long'))).toBe(t('editorSpeech.tooLong'));
    });
    test('a clip with no speech is not reported as a file problem (it refunds through the no-speech path)', () => {
        for (const code of ['source_too_large', 'source_bitrate_too_high', 'source_unreadable', 'source_unsupported']) {
            expect(speechMessage(new ApiError(400, code))).not.toBe(t('bestCut.noSpeech'));
        }
    });
    test('missing numbers never print undefined', () => {
        expect(speechMessage(new ApiError(400, 'source_too_large'))).not.toMatch(/undefined|NaN/);
    });
});
