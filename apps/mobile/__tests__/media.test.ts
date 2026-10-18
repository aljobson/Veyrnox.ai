import { estimateCredits, fetchCatalog, isSupported, kindOf, promptRequired, mediaApi, waitForJob, type CatalogModel } from '../src/lib/media';
import type { ApiClient } from '../src/lib/api';

const model = (over: Partial<CatalogModel> = {}): CatalogModel => ({
    id: 'm', name: 'M', modality: 'text-to-video', credits: 3, gated: false, durations: [5, 10],
    capabilities: { inputs: { prompt: { type: 'string' } }, media: {} }, ...over,
});

describe('catalog helpers', () => {
    test('classifies modalities', () => {
        expect(kindOf('text-to-video')).toBe('video');
        expect(kindOf('image')).toBe('image');
        expect(kindOf('text-to-speech')).toBe('audio');
        expect(kindOf('mystery')).toBeNull();
    });
    test('estimates per 5 seconds of video and flat otherwise', () => {
        expect(estimateCredits(model(), 10)).toBe(6);
        expect(estimateCredits(model(), null)).toBe(3);
        expect(estimateCredits(model({ modality: 'image' }), 10)).toBe(3);
    });
    test('supports prompt models, file-only models and models with optional files', () => {
        expect(isSupported(model())).toBe(true);
        expect(isSupported(model({ modality: 'image-to-image', capabilities: { inputs: {}, media: { image: { required: true } } } }))).toBe(true);
        expect(isSupported(model({ capabilities: { inputs: { prompt: {} }, media: { image: { required: false } } } }))).toBe(true);
    });
    test('refuses gated, unknown, stem-splitting, unknown-slot and capability-less models', () => {
        expect(isSupported(model({ gated: true }))).toBe(false);
        expect(isSupported(model({ modality: 'mystery' }))).toBe(false);
        expect(isSupported(model({ capabilities: null }))).toBe(false);
        expect(isSupported(model({ modality: 'audio-to-audio', capabilities: { inputs: {}, media: { audio: { required: true } }, outputStems: ['vocals'] } }))).toBe(false);
        expect(isSupported(model({ capabilities: { inputs: { prompt: {} }, media: { mask: { required: true } } } }))).toBe(false);
        expect(isSupported(model({ capabilities: { inputs: {}, media: {} } }))).toBe(false);
    });
    test('a prompt is required only when there is no required file', () => {
        expect(promptRequired(model())).toBe(true);
        expect(promptRequired(model({ capabilities: { inputs: { prompt: {} }, media: { image: { required: true } } } }))).toBe(false);
        expect(promptRequired(model({ capabilities: { inputs: {}, media: { image: { required: true } } } }))).toBe(false);
    });
    test('catalog keeps open, supported, known kinds', async () => {
        const fileOnly = model({ id: 'd', modality: 'image-to-image', capabilities: { inputs: {}, media: { image: { required: true } } } });
        const rows = [model({ id: 'a' }), model({ id: 'b', gated: true }), model({ id: 'c', modality: 'x' }), fileOnly];
        globalThis.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ models: rows }))) as unknown as typeof fetch;
        expect((await fetchCatalog()).map((m) => m.id)).toEqual(['a', 'd']);
    });
});

describe('media api', () => {
    test('creates a generation with the price pinned and the key', async () => {
        const request = jest.fn().mockResolvedValue({ job_id: 'j1' });
        await mediaApi({ request } as unknown as ApiClient).createGeneration({
            modelId: 'm', prompt: 'a cat', durationSeconds: 10, confirmedCredits: 6, idempotencyKey: 'key-abcdefgh',
        });
        const [path, init] = request.mock.calls[0];
        expect(path).toBe('/api/v1/generations');
        expect(JSON.parse(init.body)).toEqual({
            model_id: 'm', idempotency_key: 'key-abcdefgh', confirmed_credits: 6, inputs: { prompt: 'a cat', duration_seconds: 10 },
        });
    });
    test('sends uploaded files by slot with consent, and omits both when there are none', async () => {
        const request = jest.fn().mockResolvedValue({ job_id: 'j1' });
        await mediaApi({ request } as unknown as ApiClient).createGeneration({
            modelId: 'm', prompt: '', durationSeconds: null, confirmedCredits: 5, idempotencyKey: 'key-abcdefgh',
            sources: [{ key: 'uploads/u/1.jpg', slot: 'image' }],
        });
        expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
            model_id: 'm', idempotency_key: 'key-abcdefgh', confirmed_credits: 5, inputs: {}, source_keys: [{ key: 'uploads/u/1.jpg', slot: 'image' }], consent: true,
        });
    });
    test('library pages with the cursor from the last page', async () => {
        const request = jest.fn().mockResolvedValue({ jobs: [], next: null });
        await mediaApi({ request } as unknown as ApiClient).listJobs({ before: '2026-10-17T10:00:00Z', before_id: 'id1' });
        expect(request.mock.calls[0][0]).toContain('before=2026-10-17T10%3A00%3A00Z');
        expect(request.mock.calls[0][0]).toContain('before_id=id1');
    });
});

describe('waitForJob', () => {
    test('polls until a terminal state', async () => {
        const states = ['queued', 'running', 'succeeded'];
        const api = { getJob: jest.fn(async () => ({ state: states.shift() })) } as unknown as ReturnType<typeof mediaApi>;
        const seen: string[] = [];
        const result = await waitForJob(api, 'j', (s) => seen.push(s), new AbortController().signal, async () => {});
        expect(result).toBe('succeeded');
        expect(seen).toEqual(['queued', 'running', 'succeeded']);
    });
    test('stops when aborted', async () => {
        const c = new AbortController();
        c.abort();
        const api = { getJob: jest.fn() } as unknown as ReturnType<typeof mediaApi>;
        await waitForJob(api, 'j', () => {}, c.signal, async () => {});
        expect(api.getJob).not.toHaveBeenCalled();
    });
});
