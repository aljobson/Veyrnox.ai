import { ApiError, type ApiClient } from '../src/lib/api';
import { createBestCutFlow, type BestCutClip } from '../src/lib/bestCutFlow';
import { SPEECH_PATH } from '../src/lib/speechAnalysis';
import { resetNetworkState } from '../src/lib/networkState';

jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'acct', subscribeCacheUser: () => () => {} }));
jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { ensure: jest.fn().mockResolvedValue(undefined) } }));
const mockUpload = jest.fn();
jest.mock('../src/lib/uploads', () => ({ uploadSource: (...a: unknown[]) => mockUpload(...a), putFromDisk: jest.fn() }));

const quote = { credits: 3, max_seconds: 60 as const, languages: ['en'] };
const analysis = (id: string) => ({ version: 1, assetId: id, duration: 10, provider: 'fal-scribe-v2', transcript: 'hello there my friend', language: 'en',
    chunks: [{ start: 1, end: 1.3, text: 'hello' }, { start: 1.4, end: 1.7, text: 'there' }, { start: 1.8, end: 2.1, text: 'my' }, { start: 2.2, end: 2.5, text: 'friend' }] });
const clip = (n: number, extra: Partial<BestCutClip> = {}): BestCutClip => ({ media: { id: `l-${n}`, name: 'c', kind: 'video', frames: 300, hasAudio: true, width: 0, height: 0 }, duration: 10,
    file: { file: `file:///c${n}.mp4`, size: 1000, type: 'video/mp4' } as never, ...extra });
const api = (request: jest.Mock) => ({ request }) as unknown as ApiClient;
let n = 0; const key = () => `key-${++n}`;
beforeEach(() => { resetNetworkState(); mockUpload.mockReset().mockImplementation(async () => `uploads/acct/${++n}.mp4`); });
const router = (opts: { silent?: boolean; fail?: boolean } = {}) => jest.fn(async (path: string, init?: { method?: string; body?: string }) => {
    if (path.endsWith('/preflight')) return { clips: [{ cached: false, credits: 3 }] };
    if (path.includes('/by-key/')) throw new ApiError(404, 'request_not_found');
    if (init?.method === 'POST' && path === SPEECH_PATH) {
        if (opts.fail) throw new ApiError(502, 'provider_rejected', { refunded: true, credits: 3 });
        return opts.silent ? { id: 'x', status: 'completed', speech: false, refunded: true, credits: 3 } : { id: 'x', status: 'completed', analysis: analysis('x'), credits: 3 };
    }
    throw new Error(`unexpected ${path}`);
});

test('uploads, shows exact preflight prices, then speech clips produce analyses', async () => {
    const request = router(); const seen: unknown[] = [];
    const out = await createBestCutFlow(api(request), 'acct', key).run([clip(1)], quote, new AbortController().signal, p => seen.push(p.phase));
    expect(out.inputs).toHaveLength(1); expect(out.silent).toEqual([]); expect(out.refunded).toBe(0);
    expect(seen).toEqual(expect.arrayContaining(['uploading', 'preflight', 'transcribing', 'complete']));
    const post = request.mock.calls.find(c => c[1]?.method === 'POST' && c[0] === SPEECH_PATH)!;
    expect(JSON.parse(post[1]!.body!)).toMatchObject({ expectedCredits: 3, accepts_no_speech: true, cacheOnly: false });
});
test('all clips silent: nothing to cut, net charge zero because each is refunded', async () => {
    const out = await createBestCutFlow(api(router({ silent: true })), 'acct', key).run([clip(1), clip(2)], quote, new AbortController().signal, () => {});
    expect(out.inputs).toHaveLength(0); expect(out.silent).toEqual(['l-1', 'l-2']); expect(out.refunded).toBe(6);
});
test('mixed clips keep the speech clip and drop the silent one', async () => {
    let posts = 0;
    const request = jest.fn(async (path: string, init?: { method?: string; body?: string }) => {
        if (path.endsWith('/preflight')) return { clips: [{ cached: false, credits: 3 }] };
        if (path.includes('/by-key/')) throw new ApiError(404, 'request_not_found');
        const first = ++posts === 1;
        return first ? { id: 'a', status: 'completed', analysis: analysis('a'), credits: 3 } : { id: 'b', status: 'completed', speech: false, refunded: true, credits: 3 };
    });
    const out = await createBestCutFlow(api(request), 'acct', key).run([clip(1), clip(2)], quote, new AbortController().signal, () => {});
    expect(out.inputs).toHaveLength(1); expect(out.silent).toHaveLength(1); expect(out.refunded).toBe(3);
});
test('upload failure happens before any admission: no debit request is ever sent', async () => {
    mockUpload.mockRejectedValue(new ApiError(0, 'upload_failed')); const request = router();
    await expect(createBestCutFlow(api(request), 'acct', key).run([clip(1)], quote, new AbortController().signal, () => {})).rejects.toMatchObject({ code: 'upload_failed' });
    expect(request).not.toHaveBeenCalled();
});
test('a changed catalog price stops before charging', async () => {
    const request = jest.fn(async (path: string, _init?: { method?: string }) => path.endsWith('/preflight') ? { clips: [{ cached: false, credits: 5 }] } : (() => { throw new ApiError(404, 'request_not_found'); })());
    await expect(createBestCutFlow(api(request), 'acct', key).run([clip(1)], quote, new AbortController().signal, () => {})).rejects.toMatchObject({ code: 'price_changed' });
    expect(request.mock.calls.some(c => c[0] === SPEECH_PATH && c[1]?.method === 'POST')).toBe(false);
});
test('a definitive provider failure surfaces the refund and allows a fresh paid retry only on another tap', async () => {
    const flow = createBestCutFlow(api(router({ fail: true })), 'acct', key);
    await expect(flow.run([clip(1)], quote, new AbortController().signal, () => {})).rejects.toMatchObject({ body: { refunded: true } });
    expect(flow.identities.get('l-1')).toEqual({ source: expect.objectContaining({ type: 'upload' }) }); // upload kept, receipt reset
});
test('rejects more than 10 clips or an overlong clip before any network call', async () => {
    const request = router(); const flow = createBestCutFlow(api(request), 'acct', key);
    await expect(flow.run(Array.from({ length: 11 }, (_, i) => clip(i)), quote, new AbortController().signal, () => {})).rejects.toMatchObject({ code: 'source_too_long' });
    await expect(flow.run([clip(1, { duration: 61 })], quote, new AbortController().signal, () => {})).rejects.toMatchObject({ code: 'source_too_long' });
    expect(request).not.toHaveBeenCalled(); expect(mockUpload).not.toHaveBeenCalled();
});

test('a clip already admitted under a prior attempt is recovered by key and never charged or POSTed again', async () => {
    const request = jest.fn(async (path: string, _init?: { method?: string; body?: string }) => {
        if (path.includes('/by-key/')) return { id: 'x', status: 'completed', analysis: analysis('x'), credits: 3 };
        throw new Error(`unexpected ${path}`);
    });
    const flow = createBestCutFlow(api(request), 'acct', key);
    flow.identities.set('l-1', { source: { type: 'job', jobId: '11111111-1111-4111-8111-111111111111' }, key: 'earlier-key' });
    const seen: unknown[] = [];
    const out = await flow.run([clip(1, { file: undefined, source: { type: 'job', jobId: '11111111-1111-4111-8111-111111111111' } })], quote, new AbortController().signal, p => seen.push(p.prices));
    expect(out.inputs).toHaveLength(1);
    expect(request.mock.calls.some(c => c[1]?.method === 'POST')).toBe(false);
    expect(seen.flat().filter(Boolean)).toEqual(expect.arrayContaining([{ cached: true, credits: 0 }]));
});
