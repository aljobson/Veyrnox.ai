import { ApiError } from '../../src/lib/api';
import { probeBeatAi } from '../../src/lib/beatAi/probe';
import { failure, retireOnError } from '../../src/lib/beatAi/errors';
import { validPhonePending } from '../../src/lib/beatAi/pending';
import { validMagicPending } from '../../src/lib/beatAi/magicPending';
import { validAsset, barChoices, aiPaths } from '../../src/lib/beatAi/shared';
import { client, owner, quote, row, magicRow, asset } from './fixtures';
for (const [status, code, expected] of [[404, 'anything', 'off'], [503, 'beat_ai_unavailable', 'off'], [404, 'music_unavailable', 'off'], [400, 'prompt_invalid', 'on'], [401, 'not_authenticated', 'signed_out'], [0, 'network', 'offline'], [500, 'bad', 'error']] as const) {
    test(`probe ${status}/${code}: ${expected}`, async () => {
        const c = client(); c.request.mockRejectedValue(new ApiError(status, 'envelope', { error: { code } }));
        expect(await probeBeatAi(c.api, owner)).toEqual({ state: expected });
        expect(c.request).toHaveBeenCalledWith('/api/v1/music/generation-quotes', expect.objectContaining({ body: '{"model_id":"ace-step-loop"}' }), { owner });
    });
}
test('2xx probe fails closed; guards refuse missing and nonfinite quote fields', async () => {
    const c = client(); c.request.mockResolvedValue(quote);
    expect(await probeBeatAi(c.api, owner)).toEqual({ state: 'error' });
    expect(await c.client.quote('generate', undefined, {})).toEqual(quote);
    for (const bad of [{ ...quote, total_credits: NaN }, { ...quote, affordable: 1 }, { ...quote, quote_id: 'bad' }, { ...quote, balance: undefined }]) {
        c.request.mockResolvedValue(bad); await expect(c.client.quote('generate', undefined, {})).rejects.toMatchObject({ code: 'bad_response' });
    }
});
test('string/envelope errors and retry headers are adapted before refusal', () => {
    const e = new ApiError(429, 'fallback', { error: { code: 'rate_limited' }, retryAfterSeconds: 60 });
    expect(failure(e)).toEqual({ status: 429, code: 'rate_limited', retryAfter: 60 }); expect(retireOnError(e)).toBe(false);
    for (const code of ['beat_ai_unavailable', 'music_unavailable']) expect(retireOnError(new ApiError(404, '', { error: code }))).toBe(false);
    expect(retireOnError(new ApiError(400, 'prompt_invalid'))).toBe(true);
});
test('typed seam imports without browser storage/audio and validates both receipt formats', () => {
    expect(validPhonePending(row())).toBe(true); expect(validMagicPending(magicRow())).toBe(true);
    expect(validPhonePending({ ...row(), owner: 'bad' })).toBe(false);
    expect(validPhonePending({ ...row(), quote: { ...quote, expires_at: 'tomorrow' } })).toBe(false);
    expect(validMagicPending({ ...magicRow(), key: row().key })).toBe(false);
    expect(validAsset(asset, 120)).toBe(true); expect(barChoices(120)).toContain(4); expect(aiPaths('generate').submit).toBe('/music/generations');
});
test('poll accepts nullable unfinished candidate references, but rejects malformed references', async () => {
    const c = client();
    c.request.mockResolvedValue({ state: 'running', candidates: [{ ordinal: 1, state: 'queued', song_id: null, version_id: null, job_id: null }] });
    await expect(c.client.poll({ op: 'generate', requestId: row().quoteId })).resolves.toMatchObject({ state: 'running' });
    c.request.mockResolvedValue({ state: 'succeeded', candidates: [{ ordinal: 1, state: 'succeeded', song_id: 'bad' }] });
    await expect(c.client.poll({ op: 'generate', requestId: row().quoteId })).rejects.toMatchObject({ code: 'bad_response' });
});
test('every authenticated endpoint uses the owner fence and rejects malformed responses', async () => {
    const c = client(); c.request.mockResolvedValue({});
    for (const call of [() => c.client.submit(row()), () => c.client.poll({ op: 'generate', requestId: row().quoteId }), () => c.client.song(asset.ref.songId), () => c.client.sign(asset)]) {
        await expect(call()).rejects.toMatchObject({ code: 'bad_response' });
        expect(c.request.mock.calls.at(-1)?.[2]).toEqual({ owner });
    }
});
test('the pure seam never reads browser storage at import time', () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('browser_storage_read'); } });
    try { jest.isolateModules(() => { expect(require('../../src/lib/beatAi/shared').AI_TERMINAL.has('succeeded')).toBe(true); }); }
    finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete (globalThis as { localStorage?: unknown }).localStorage; }
});
