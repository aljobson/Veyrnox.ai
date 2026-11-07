import { ApiError, type ApiClient } from '../src/lib/api';
import { createGenerationSubmit, generationMessage } from '../src/lib/generationSubmit';
import { inlineBlockReason, photoSlot, templateRequest } from '../src/lib/templateGenerate';
import type { Preset } from '../src/lib/presets';
import type { CatalogModel } from '../src/lib/media';

const mockCreate = jest.fn();
jest.mock('expo-crypto', () => { let n = 0; return { randomUUID: () => `key-${++n}` }; });
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), mediaApi: () => ({ createGeneration: mockCreate }) }));
const api = {} as ApiClient;

const model: CatalogModel = { id: 'vid', name: 'Video', modality: 'text-to-video', credits: 3, gated: false, durations: [5, 10], capabilities: { inputs: { prompt: {}, aspect_ratio: { values: ['16:9', '9:16'] } } } } as CatalogModel;
const preset = { id: 'rap-takeover', title: 'Rap', category: 'STYLE', modelId: 'vid', modelName: 'Video', modality: 'text-to-video', prompt: 'a rap battle', needs: null, durationSeconds: 5, credits: 3, available: true, isNew: false } as unknown as Preset;
const choice = { prompt: 'a rap battle', aspect: '9:16', duration: 10 };

beforeEach(() => mockCreate.mockReset());

test('the request is Create\'s for the template: its prompt, model, length, shape, template id and catalogue price', () => {
    const request = templateRequest(preset, model, choice);
    expect(request).toMatchObject({ modelId: 'vid', prompt: 'a rap battle', durationSeconds: 10, textKey: 'prompt', references: [], preset: 'rap-takeover', confirmedCredits: 6 });
    expect(request.sourceRights).toBeUndefined();
    expect(request.extraInputs).toMatchObject({ aspect_ratio: '9:16' });
    expect(templateRequest(preset, { ...model, id: 'other' }, choice).preset).toBeUndefined();
    expect(templateRequest(preset, model, { ...choice, prompt: '  edited  ' }).prompt).toBe('edited');
});

test('inline success: one call with a quote ceiling and a key, reports the job', async () => {
    const submit = createGenerationSubmit(); const onJob = jest.fn();
    const request = templateRequest(preset, model, choice);
    const quote = submit.snapshot(request, 1, 6, 0);
    mockCreate.mockResolvedValueOnce({ job_id: 'job-1' });
    expect(await submit.run(api, request, 1, undefined, onJob, quote)).toBe('job-1');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ maxCharge: 6, idempotencyKey: 'key-1', preset: 'rap-takeover', references: [] });
    expect(onJob).toHaveBeenCalledWith('job-1', 0);
});

test('failure with a refund: a refused job is worded by Create\'s messages and its key is dead', async () => {
    const submit = createGenerationSubmit();
    const request = templateRequest(preset, model, choice);
    mockCreate.mockRejectedValueOnce(new ApiError(422, 'provider_submit_failed')).mockResolvedValueOnce({ job_id: 'job-2' });
    const failure = await submit.run(api, request, 1).catch(e => e);
    expect(generationMessage(failure)).toBeTruthy();
    expect(generationMessage(new ApiError(402, 'insufficient_credits'))).toBeTruthy();
    await submit.run(api, request, 1);
    expect(mockCreate.mock.calls[1][0].idempotencyKey).not.toBe(mockCreate.mock.calls[0][0].idempotencyKey);
});

test('retry after a lost reply uses the same key, so it is charged once', async () => {
    const submit = createGenerationSubmit();
    const request = templateRequest(preset, model, choice);
    mockCreate.mockRejectedValueOnce(new ApiError(0, 'network')).mockResolvedValueOnce({ job_id: 'job-3' });
    await expect(submit.run(api, request, 1)).rejects.toMatchObject({ code: 'network' });
    await submit.run(api, templateRequest(preset, model, choice), 1);
    expect(mockCreate.mock.calls[1][0].idempotencyKey).toBe(mockCreate.mock.calls[0][0].idempotencyKey);
    // Changing the prompt is a different request and gets a new key.
    mockCreate.mockResolvedValueOnce({ job_id: 'job-4' });
    await submit.run(api, templateRequest(preset, model, { ...choice, prompt: 'new words' }), 1);
    expect(mockCreate.mock.calls[2][0].idempotencyKey).not.toBe(mockCreate.mock.calls[0][0].idempotencyKey);
});

test('a template that needs media, a described voice, or an unavailable model falls back to Create', () => {
    expect(inlineBlockReason(preset, model)).toBeNull();
    expect(inlineBlockReason({ ...preset, needs: 'Your photo' }, model)).toBe('media');
    const withSlot = { ...model, capabilities: { inputs: { prompt: {} }, media: { image: { required: true } } } } as unknown as CatalogModel;
    expect(inlineBlockReason(preset, withSlot)).toBe('media');
    const voice = { ...model, capabilities: { inputs: { prompt: {}, voice_description: {} } } } as unknown as CatalogModel;
    expect(inlineBlockReason(preset, voice)).toBe('options');
    expect(inlineBlockReason({ ...preset, available: false }, model)).toBe('unavailable');
    expect(inlineBlockReason(preset, undefined)).toBe('unavailable');
});

test('the gates stay: no source rights are sent, and the provider agreement is enforced inside the API client', () => {
    expect(templateRequest(preset, model, choice).sourceRights).toBeUndefined();
    const media = require('fs').readFileSync(require('path').join(process.cwd(), 'src/lib/media.ts'), 'utf8');
    expect(media).toMatch(/await aiConsent\.ensure\('\/api\/v1\/generations', 'POST'\)/);
});

describe('a template whose only media is one photo', () => {
    const photoModel = { ...model, capabilities: { inputs: { prompt: {}, aspect_ratio: { values: ['16:9', '9:16'] } }, media: { image: { required: true } } } } as unknown as CatalogModel;
    const needing = { ...preset, needs: 'A clear portrait of the person' } as Preset;
    const photo = [{ slot: 'image', origin: 'upload', key: 'u/1' }] as const;

    test('generates on its own page only when the page can take the photo', () => {
        expect(photoSlot(photoModel)?.slot).toBe('image');
        expect(inlineBlockReason(needing, photoModel, { photo: true })).toBeNull();
        expect(inlineBlockReason(needing, photoModel)).toBe('media');
        expect(inlineBlockReason({ ...preset, needs: 'One video and two pictures' } as Preset, photoModel, { photo: true })).toBe('media');
        const withVideo = { ...photoModel, capabilities: { inputs: { prompt: {} }, media: { image: { required: true }, video: { required: true } } } } as unknown as CatalogModel;
        expect(inlineBlockReason(needing, withVideo, { photo: true })).toBe('media');
        expect(inlineBlockReason(needing, model, { photo: true })).toBe('media');
        const twoImages = { ...photoModel, capabilities: { inputs: { prompt: {} }, media: { image: { required: true, minFiles: 2, maxFiles: 2 } } } } as unknown as CatalogModel;
        expect(photoSlot(twoImages)).toBeNull();
        expect(inlineBlockReason(needing, twoImages, { photo: true })).toBe('media');
    });

    test('the request carries the upload reference, the rights tick and a line naming the person as the lead', () => {
        const request = templateRequest(needing, photoModel, { ...choice, references: photo, sourceRights: true });
        expect(request.references).toEqual(photo);
        expect(request.sourceRights).toBe(true);
        expect(request.prompt.startsWith('a rap battle\n\n')).toBe(true);
        expect(request.prompt).toMatch(/person in the attached photo is the main character/);
        expect(templateRequest(needing, photoModel, { ...choice, references: photo }).sourceRights).toBe(false);
        const plain = templateRequest(preset, model, choice);
        expect(plain.prompt).toBe('a rap battle');
        expect(plain.sourceRights).toBeUndefined();
    });

    test('changing the photo is a different request with a new key', async () => {
        const submit = createGenerationSubmit();
        mockCreate.mockResolvedValue({ job_id: 'j' });
        await submit.run(api, templateRequest(needing, photoModel, { ...choice, references: photo, sourceRights: true }), 1);
        await submit.run(api, templateRequest(needing, photoModel, { ...choice, references: [{ slot: 'image', origin: 'upload', key: 'u/2' }], sourceRights: true }), 1);
        expect(mockCreate.mock.calls[1][0].idempotencyKey).not.toBe(mockCreate.mock.calls[0][0].idempotencyKey);
    });
});
