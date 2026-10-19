import { ApiError, type ApiClient } from '../src/lib/api';
import {
    CAPTION_PRESETS,
    DEFAULT_CAPTION_PRESET,
    MAX_CLIPS,
    MAX_OUTPUT_S,
    editBody,
    editErrorKey,
    fetchClipLength,
    moveClip,
    newClip,
    priceChanged,
    quoteEdit,
    stepEnd,
    stepStart,
    submitEdit,
    totalSeconds,
    validateEdit,
    type Clip,
} from '../src/lib/clipEdit';

const clip = (o: Partial<Clip> = {}): Clip => ({ jobId: '3f2b8a52-6c0e-4d7a-9b1f-0a1b2c3d4e5f', label: 'Teaser', length: 10, start: 0, end: 10, ...o });
const apiWith = (impl: (path: string, init?: RequestInit) => unknown) => {
    const request = jest.fn(async (p: string, i?: RequestInit) => {
        const r = impl(p, i);
        if (r instanceof Error) throw r;
        return r;
    });
    return { api: { request } as unknown as ApiClient, request };
};
const body = (r: jest.Mock, i = 0) => JSON.parse(String((r.mock.calls[i][1] as RequestInit).body));

describe('limits and presets', () => {
    test('mirror the server', () => {
        expect(MAX_CLIPS).toBe(10);
        expect(MAX_OUTPUT_S).toBe(60);
        expect(CAPTION_PRESETS).toHaveLength(30);
        expect(CAPTION_PRESETS).toContain(DEFAULT_CAPTION_PRESET);
    });
});

describe('newClip', () => {
    test('starts at the beginning and ends at the end, but never past the output cap', () => {
        expect(newClip({ jobId: 'j', label: 'A' }, 12.34)).toMatchObject({ start: 0, end: 12.3, length: 12.34 });
        expect(newClip({ jobId: 'j', label: 'A' }, 120).end).toBe(MAX_OUTPUT_S);
    });
    test('a length that could not be read gives a clip that cannot be sent', () => {
        const c = newClip({ jobId: 'j', label: 'A' }, null);
        expect(c.length).toBeNull();
        expect(validateEdit([c], null)).toBe('unknown_length');
    });
});

describe('stepping the start and end', () => {
    test('moves in half seconds and stays inside the clip', () => {
        expect(stepStart(clip(), 0.5).start).toBe(0.5);
        expect(stepStart(clip(), -0.5).start).toBe(0);
        expect(stepEnd(clip(), -0.5).end).toBe(9.5);
        expect(stepEnd(clip(), 0.5).end).toBe(10);
    });
    test('keeps at least half a second between start and end', () => {
        expect(stepStart(clip({ start: 9, end: 9.5 }), 0.5).start).toBe(9);
        expect(stepEnd(clip({ start: 2, end: 2.5 }), -0.5).end).toBe(2.5);
    });
    test('repeated steps do not drift', () => {
        let c = clip({ length: 3, start: 0, end: 3 });
        for (let i = 0; i < 6; i++) c = stepEnd(c, -0.5);
        expect(c.end).toBe(0.5);
        for (let i = 0; i < 20; i++) c = stepEnd(c, 0.1);
        expect(Number.isInteger(c.end * 100)).toBe(true);
    });
});

describe('moveClip', () => {
    const a = clip({ jobId: 'a' });
    const b = clip({ jobId: 'b' });
    const c = clip({ jobId: 'c' });
    test('moves one place and stops at the ends', () => {
        expect(moveClip([a, b, c], 1, -1).map((x) => x.jobId)).toEqual(['b', 'a', 'c']);
        expect(moveClip([a, b, c], 1, 1).map((x) => x.jobId)).toEqual(['a', 'c', 'b']);
        expect(moveClip([a, b, c], 0, -1).map((x) => x.jobId)).toEqual(['a', 'b', 'c']);
        expect(moveClip([a, b, c], 2, 1).map((x) => x.jobId)).toEqual(['a', 'b', 'c']);
    });
});

describe('totalSeconds and validateEdit', () => {
    test('adds the chosen parts', () => {
        expect(totalSeconds([clip({ start: 1, end: 4 }), clip({ start: 0, end: 2.5 })])).toBe(5.5);
        expect(totalSeconds([])).toBe(0);
    });
    test('a good edit has no problem', () => {
        expect(validateEdit([clip({ start: 1, end: 5 })], null)).toBeNull();
    });
    test('needs a clip, not too many, and not past the output cap', () => {
        expect(validateEdit([], null)).toBe('no_clips');
        expect(validateEdit(Array.from({ length: MAX_CLIPS + 1 }, () => clip({ start: 0, end: 1 })), null)).toBe('too_many');
        expect(validateEdit([clip({ length: 100, start: 0, end: 61 })], null)).toBe('too_long');
    });
    test('a range outside the clip, or an end before the start, is refused', () => {
        expect(validateEdit([clip({ start: 0, end: 11 })], null)).toBe('bad_range');
        expect(validateEdit([clip({ start: 5, end: 5 })], null)).toBe('bad_range');
        expect(validateEdit([clip({ start: -1, end: 3 })], null)).toBe('bad_range');
    });
    test('the whole clip with no captions would change nothing', () => {
        expect(validateEdit([clip()], null)).toBe('nothing_to_do');
        expect(validateEdit([clip()], DEFAULT_CAPTION_PRESET)).toBeNull();
        expect(validateEdit([clip(), clip()], null)).toBeNull();
    });
});

describe('editBody', () => {
    test('is the clip-edit request with the clips in order and numbers rounded', () => {
        const b = editBody([clip({ jobId: 'j1', start: 1.234, end: 5.678 }), clip({ jobId: 'j2', start: 0, end: 2 })], null, 7, 'draft-a');
        expect(b).toEqual({
            model_id: 'clip-edit',
            idempotency_key: 'draft-a',
            confirmed_credits: 7,
            inputs: { clips: [{ asset_id: 'j1', in_s: 1.23, out_s: 5.68 }, { asset_id: 'j2', in_s: 0, out_s: 2 }] },
        });
    });
    test('captions go in only when a preset is chosen', () => {
        expect((editBody([clip()], 'glass', 0, 'draft-a').inputs as { captions?: unknown }).captions).toEqual({ preset: 'glass' });
        expect('captions' in (editBody([clip()], null, 0, 'draft-a').inputs as object)).toBe(false);
    });
});

describe('quoteEdit', () => {
    test('asks with 0 and reads the price from the refusal, which charges nothing', async () => {
        const { api, request } = apiWith(() => new ApiError(409, 'credit_confirmation_mismatch', { error: 'credit_confirmation_mismatch', expected_credits: 12 }));
        expect(await quoteEdit(api, [clip()], 'simple', 'draft-a')).toEqual({ kind: 'quote', credits: 12 });
        expect(body(request).confirmed_credits).toBe(0);
    });
    test('a rejected edit (for example a range past the end) is passed on, still uncharged', async () => {
        const { api } = apiWith(() => new ApiError(400, 'clip_range', { error: 'clip_range' }));
        await expect(quoteEdit(api, [clip()], null, 'draft-a')).rejects.toMatchObject({ status: 400, code: 'clip_range' });
    });
    test('if the server accepts the 0 and makes a job, that job is reported, not hidden', async () => {
        const { api } = apiWith(() => ({ job_id: 'j9' }));
        expect(await quoteEdit(api, [clip()], null, 'draft-a')).toEqual({ kind: 'created', jobId: 'j9' });
    });
    test('a refusal without a price is an error, not a price of zero', async () => {
        const { api } = apiWith(() => new ApiError(409, 'credit_confirmation_mismatch', { error: 'credit_confirmation_mismatch' }));
        await expect(quoteEdit(api, [clip()], null, 'draft-a')).rejects.toBeInstanceOf(ApiError);
    });
});

describe('submitEdit and priceChanged', () => {
    test('sends the exact price that was shown and returns the job', async () => {
        const { api, request } = apiWith(() => ({ job_id: 'j1', balance_after: 40 }));
        expect(await submitEdit(api, [clip()], null, 12, 'draft-a')).toEqual({ jobId: 'j1' });
        expect(body(request).confirmed_credits).toBe(12);
    });
    test('a changed price is a number to show again, never a charge', () => {
        expect(priceChanged(new ApiError(409, 'credit_confirmation_mismatch', { expected_credits: 15 }))).toBe(15);
        expect(priceChanged(new ApiError(409, 'credit_confirmation_mismatch', {}))).toBeNull();
        expect(priceChanged(new ApiError(400, 'clip_range', {}))).toBeNull();
        expect(priceChanged(new Error('x'))).toBeNull();
    });
});

describe('editErrorKey', () => {
    const k = (status: number, code: string) => editErrorKey(new ApiError(status, code, { error: code }));
    test('names what to change for each refusal the server gives before charging', () => {
        expect(k(400, 'consent_declined')).toBe('edit.err.consent');
        expect(k(400, 'consent_required')).toBe('edit.err.consent');
        expect(k(400, 'clip_range')).toBe('edit.err.clipRange');
        expect(k(400, 'too_long')).toBe('edit.err.tooLong');
        expect(k(400, 'nothing_to_do')).toBe('edit.err.nothingToDo');
        expect(k(400, 'mixed_aspect')).toBe('edit.err.mixedAspect');
        expect(k(400, 'clip_not_video')).toBe('edit.err.notVideo');
        expect(k(400, 'clip_unreadable')).toBe('edit.err.unreadable');
        expect(k(404, 'asset_not_found')).toBe('edit.err.gone');
        expect(k(400, 'captions_unavailable')).toBe('edit.err.captionsOff');
        expect(k(400, 'inputs_invalid:clips')).toBe('edit.err.invalid');
        expect(k(400, 'inputs_invalid:captions')).toBe('edit.err.invalid');
        expect(k(402, 'insufficient_credits')).toBe('edit.err.credits');
    });
    test('offline, busy and anything else', () => {
        expect(editErrorKey(new ApiError(0, 'network'))).toBe('edit.err.network');
        expect(k(429, 'rate_limited')).toBe('edit.err.rate');
        expect(k(502, 'edit_lookup_failed')).toBe('edit.err.busy');
        expect(editErrorKey(new Error('x'))).toBe('common.error');
    });
});

describe('fetchClipLength', () => {
    test('asks the server for the length of that job and returns its seconds', async () => {
        const { api, request } = apiWith(() => ({ seconds: 8.04, width: 320, height: 568, size_bytes: 40099, mime_type: 'video/mp4' }));
        expect(await fetchClipLength(api, 'job one/2')).toBe(8.04);
        expect(request.mock.calls[0][0]).toBe('/api/v1/jobs/job%20one%2F2/media-info');
    });
    test.each([[404, 'not_found'], [400, 'not_video'], [422, 'unreadable'], [429, 'rate_limited'], [503, 'rate_limit_unavailable'], [0, 'network']])(
        'a %s answer gives null so the screen falls back to the player',
        async (status, code) => {
            const { api } = apiWith(() => new ApiError(status, code, { error: code }));
            expect(await fetchClipLength(api, 'j1')).toBeNull();
        },
    );
    test.each([[0], [-3], [Number.NaN], ['8'], [null], [undefined]])('a length of %p is not trusted', async (seconds) => {
        const { api } = apiWith(() => ({ seconds }));
        expect(await fetchClipLength(api, 'j1')).toBeNull();
    });
    test('an answer with no body is not trusted', async () => {
        const { api } = apiWith(() => null);
        expect(await fetchClipLength(api, 'j1')).toBeNull();
    });
});

import { newAudio, stepOffset } from '../src/lib/clipEdit';
import { fileNameFor } from '../src/lib/output';
import { mediaApi } from '../src/lib/media';

describe('sound under the video', () => {
    const aud = newAudio({ jobId: '9f2b8a52-6c0e-4d7a-9b1f-0a1b2c3d4e5f', label: 'Song' });
    test('the body names the audio creation and its offset, beside the clips', () => {
        const b = editBody([clip()], null, 4, 'k', { ...aud, offset: 1.5 }) as { inputs: Record<string, unknown> };
        expect(b.inputs.audio).toEqual({ asset_id: aud.jobId, offset_s: 1.5 });
        expect((editBody([clip()], null, 4, 'k') as { inputs: Record<string, unknown> }).inputs.audio).toBeUndefined();
    });
    test('the offset stays inside the video', () => {
        expect(stepOffset(aud, -0.5, 10).offset).toBe(0);
        expect(stepOffset({ ...aud, offset: 9.5 }, 0.5, 10).offset).toBe(9.5);
        expect(validateEdit([clip()], null, { ...aud, offset: 10 })).toBe('audio_offset');
        expect(validateEdit([clip({ end: 5 })], null, { ...aud, offset: 5 })).toBe('audio_offset');
    });
    test('a whole clip with sound is an edit, not nothing to do', () => {
        expect(validateEdit([clip()], null)).toBe('nothing_to_do');
        expect(validateEdit([clip()], null, aud)).toBeNull();
    });
    test('the quote and the send carry the sound', async () => {
        const { api, request } = apiWith(() => new ApiError(409, 'credit_confirmation_mismatch', { expected_credits: 4 }));
        await quoteEdit(api, [clip()], null, 'k', aud);
        expect((body(request).inputs as Record<string, unknown>).audio).toBeDefined();
    });
    test('the server errors for sound map to words', () => {
        expect(editErrorKey(new ApiError(400, 'audio_not_audio'))).toBe('edit.err.notAudio');
        expect(editErrorKey(new ApiError(400, 'audio_invalid'))).toBe('edit.problem.audio_offset');
    });
});

describe('stems', () => {
    test('each track gets its own file name; an unknown label adds nothing', () => {
        const id = 'abcdef12-0000-4000-8000-000000000000';
        expect(fileNameFor(id, 'audio/mpeg', 'vocals')).toBe('veyrnox-abcdef12-vocals.mp3');
        expect(fileNameFor(id, 'audio/mpeg', '../x')).toBe('veyrnox-abcdef12.mp3');
        expect(fileNameFor(id, 'audio/mpeg')).toBe('veyrnox-abcdef12.mp3');
    });
    test('asks the asset route for one stem, encoded', async () => {
        const request = jest.fn().mockResolvedValue({ url: 'u', mime_type: 'audio/mpeg' });
        await mediaApi({ request } as never).getAsset('j1', 'drums');
        expect(request).toHaveBeenCalledWith('/api/v1/jobs/j1/asset?stem=drums');
        await mediaApi({ request } as never).getAsset('j1');
        expect(request).toHaveBeenLastCalledWith('/api/v1/jobs/j1/asset');
    });
});
