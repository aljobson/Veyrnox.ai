import { audioLengthInvalid, voiceIsMissing, SAVED_DRAFT_VERSION, batchCost, draftIsEmpty, filterByTier, freeLeftFor, imageCount, inputsForIndex, modelsForGoal, optionsFor, parseDraft, seedIsInvalid, settingsInputs, takesImageCount, tierById } from '../src/lib/createOptions';
import { DEFAULT_CINEMA } from '../src/lib/cinemaCamera';
import { loadDraft, saveDraft, clearDraft } from '../src/lib/createDraftStore';
import { createCache, createMemoryStorage } from '../src/lib/cache';
import { freeLines } from '../src/lib/freeAllowance';
import { mediaApi, type CatalogModel } from '../src/lib/media';
import type { ApiClient } from '../src/lib/api';

jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { ensure: async () => undefined, hasAgreed: async () => true } }));

const model = (over: Partial<CatalogModel> = {}): CatalogModel => ({
    id: 'm', name: 'M', modality: 'text-to-image', credits: 3, gated: false, durations: [],
    capabilities: { inputs: { prompt: { type: 'string' } }, media: {} }, ...over,
});
const rich = model({
    capabilities: { inputs: { prompt: {}, seed: { type: 'int' }, negative_prompt: { type: 'string', max: 500 }, aspect_ratio: { type: 'enum', values: ['16:9', '1:1'] } }, media: {} },
});

describe('goals and tiers', () => {
    const list = [model({ id: 'a', credits: 1 }), model({ id: 'b', credits: 2, modality: 'text-to-video' }), model({ id: 'c', credits: 3 }), model({ id: 'd', credits: 9, modality: 'text-to-speech' })];
    test('goal filters by kind and All keeps everything', () => {
        expect(modelsForGoal(list, 'image').map((m) => m.id)).toEqual(['a', 'c']);
        expect(modelsForGoal(list, 'audio').map((m) => m.id)).toEqual(['d']);
        expect(modelsForGoal(list, 'all')).toHaveLength(4);
    });
    test('tiers are thirds of the distinct prices, equal prices share a tier', () => {
        const six = [1, 1, 2, 3, 4, 5].map((c, i) => model({ id: `x${i}`, credits: c }));
        const tiers = tierById(six);
        expect(tiers.get('x0')).toBe('low');
        expect(tiers.get('x1')).toBe('low');
        expect(tiers.get('x5')).toBe('high');
        expect(filterByTier(six, 'high').map((m) => m.id)).toEqual(['x5']);
        expect(filterByTier(six, null)).toHaveLength(6);
    });
});

describe('model options from the catalog', () => {
    test('reads seed, negative prompt limit and aspect ratios', () => {
        expect(optionsFor(rich)).toEqual({ seed: true, negativeMax: 500, aspects: ['16:9', '1:1'], voice: false, audioLength: null });
        expect(optionsFor(model())).toEqual({ seed: false, negativeMax: null, aspects: [], voice: false, audioLength: null });
    });
    test('negative prompt defaults to the 2000 character limit', () => {
        expect(optionsFor(model({ capabilities: { inputs: { negative_prompt: {} }, media: {} } })).negativeMax).toBe(2000);
    });
    test('image count is for image models only, never an Auto Short', () => {
        expect(takesImageCount(model())).toBe(true);
        expect(takesImageCount(model({ modality: 'text-to-video' }))).toBe(false);
        expect(takesImageCount(model({ capabilities: { inputs: { topic: {} }, media: {} } }))).toBe(false);
        expect(imageCount(model(), 4)).toBe(4);
        expect(imageCount(model(), 9)).toBe(1);
        expect(imageCount(model({ modality: 'text-to-video' }), 3)).toBe(1);
    });
    test('sends only what the model takes and the person set', () => {
        const o = optionsFor(rich);
        expect(settingsInputs(o, { seed: '42', negative: ' blur ', aspect: '1:1' })).toEqual({ seed: 42, negative_prompt: 'blur', aspect_ratio: '1:1' });
        expect(settingsInputs(o, { seed: '', negative: '', aspect: null })).toEqual({});
        expect(settingsInputs(o, { seed: '2147483648', negative: '', aspect: '4:3' })).toEqual({});
        expect(settingsInputs(optionsFor(model()), { seed: '5', negative: 'x', aspect: '1:1' })).toEqual({});
        expect(settingsInputs(o, { seed: '1', negative: 'a'.repeat(900), aspect: null }).negative_prompt).toHaveLength(500);
    });
    test('flags a seed that would be dropped', () => {
        expect(seedIsInvalid('')).toBe(false);
        expect(seedIsInvalid('123')).toBe(false);
        expect(seedIsInvalid('12a')).toBe(true);
        expect(seedIsInvalid('2147483648')).toBe(true);
    });
    test('a set seed moves by one per image and wraps', () => {
        expect(inputsForIndex({ seed: 10 }, 2, 3)).toEqual({ seed: 12 });
        expect(inputsForIndex({ seed: 2147483647 }, 1, 2)).toEqual({ seed: 0 });
        const same = { aspect_ratio: '1:1' };
        expect(inputsForIndex(same, 1, 3)).toBe(same);
        const one = { seed: 5 };
        expect(inputsForIndex(one, 0, 1)).toBe(one);
    });
});

describe('price including count and free runs', () => {
    test('count multiplies the unit price', () => expect(batchCost(3, 4, 0)).toBe(12));
    test('the first free runs of a batch cost nothing', () => {
        expect(batchCost(3, 4, 1)).toBe(9);
        expect(batchCost(3, 2, 5)).toBe(0);
        expect(batchCost(3, 1, 0)).toBe(3);
    });
    test('reads free runs left defensively', () => {
        expect(freeLeftFor({ a: 2 }, 'a')).toBe(2);
        expect(freeLeftFor({ a: 0 }, 'a')).toBe(0);
        expect(freeLeftFor({ a: 1.5 }, 'a')).toBe(0);
        expect(freeLeftFor({}, 'a')).toBe(0);
    });
    test('free lines still skip models the catalog does not list', () => {
        expect(freeLines({ a: 1, z: 3 }, [{ id: 'a', name: 'A' }])).toEqual(['A: 1 free run left today']);
    });
});

describe('draft', () => {
    const draft = { v: SAVED_DRAFT_VERSION, modelId: 'm', prompt: 'a cat', duration: null, aspect: '1:1', count: 2, seed: '7', negative: 'blur', voice: '', audioSeconds: '', cinemaOn: false, cinema: DEFAULT_CINEMA, characterOn: false, character: {} } as const;
    test('a draft saved before the camera and voice reads back with their defaults', () => {
        const { voice, audioSeconds, cinemaOn, cinema, characterOn, character, ...old } = draft;
        expect(parseDraft(old, 'm')).toEqual(draft);
    });
    test('reads back only a well formed draft for the same model', () => {
        expect(parseDraft(draft, 'm')).toEqual(draft);
        expect(parseDraft(draft, 'other')).toBeNull();
        expect(parseDraft({ ...draft, v: 9 }, 'm')).toBeNull();
        expect(parseDraft({ ...draft, prompt: 4 }, 'm')).toBeNull();
        expect(parseDraft(null, 'm')).toBeNull();
    });
    test('an empty form is not a draft', () => {
        expect(draftIsEmpty({ prompt: ' ', seed: '', negative: '' })).toBe(true);
        expect(draftIsEmpty({ prompt: 'x', seed: '', negative: '' })).toBe(false);
    });
    test('saved per account, restored, and cleared', async () => {
        const cache = createCache(createMemoryStorage());
        await saveDraft(draft, cache, 'u1');
        expect(await loadDraft('m', cache, 'u1')).toEqual(draft);
        expect(await loadDraft('m', cache, 'u2')).toBeNull();
        expect(await loadDraft('other', cache, 'u1')).toBeNull();
        await clearDraft(cache, 'u1');
        expect(await loadDraft('m', cache, 'u1')).toBeNull();
    });
    test('an empty form clears the saved draft, and nothing is saved with no account', async () => {
        const cache = createCache(createMemoryStorage());
        await saveDraft(draft, cache, 'u1');
        await saveDraft({ ...draft, prompt: '', seed: '', negative: '' }, cache, 'u1');
        expect(await loadDraft('m', cache, 'u1')).toBeNull();
        await saveDraft(draft, cache, undefined);
        expect(await loadDraft('m', cache, undefined)).toBeNull();
    });
    test('wiping the cache removes the draft', async () => {
        const cache = createCache(createMemoryStorage());
        await saveDraft(draft, cache, 'u1');
        await cache.clear();
        expect(await loadDraft('m', cache, 'u1')).toBeNull();
    });
});

describe('request carries the options', () => {
    test('extra inputs are sent beside the prompt and cannot replace it', async () => {
        const request = jest.fn().mockResolvedValue({ job_id: 'j' });
        await mediaApi({ request } as unknown as ApiClient).createGeneration({
            modelId: 'm', prompt: 'a cat', durationSeconds: null, confirmedCredits: 3, idempotencyKey: 'k',
            extraInputs: { seed: 5, aspect_ratio: '1:1', prompt: 'smuggled' },
        });
        const body = JSON.parse(request.mock.calls[0][1].body);
        expect(body.inputs).toEqual({ seed: 5, aspect_ratio: '1:1', prompt: 'a cat' });
        expect(body.confirmed_credits).toBe(3);
    });
});

describe('voice and audio length', () => {
    const speech = model({ modality: 'text-to-speech', capabilities: { inputs: { prompt: {}, voice_description: { type: 'string', max: 500 }, duration: { type: 'int', min: 5, max: 60, default: 30 } }, media: {} } });
    test('reads the voice requirement and the length range', () => {
        expect(optionsFor(speech)).toMatchObject({ voice: true, audioLength: { min: 5, max: 60, def: 30 } });
        expect(optionsFor(model()).voice).toBe(false);
        expect(optionsFor(model()).audioLength).toBeNull();
    });
    test('a default outside the range falls back to the top; a bad range is no control', () => {
        const odd = (d: unknown) => model({ modality: 'text-to-speech', capabilities: { inputs: { duration: d as never }, media: {} } });
        expect(optionsFor(odd({ type: 'int', min: 5, max: 60, default: 99 })).audioLength?.def).toBe(60);
        expect(optionsFor(odd({ type: 'int', min: 9, max: 5 })).audioLength).toBeNull();
        expect(optionsFor(odd({ type: 'string' })).audioLength).toBeNull();
    });
    test('a described voice is required and sent trimmed', () => {
        const o = optionsFor(speech);
        expect(voiceIsMissing(o, '  ')).toBe(true);
        expect(voiceIsMissing(o, 'warm and slow')).toBe(false);
        expect(voiceIsMissing(optionsFor(model()), '')).toBe(false);
        expect(settingsInputs(o, { seed: '', negative: '', aspect: null, voice: ' warm ' })).toMatchObject({ voice_description: 'warm' });
    });
    test('length: empty means the default, a whole number in range is sent, anything else is refused', () => {
        const o = optionsFor(speech);
        expect(audioLengthInvalid(o, '')).toBe(false);
        expect(audioLengthInvalid(o, '4')).toBe(true);
        expect(audioLengthInvalid(o, '61')).toBe(true);
        expect(audioLengthInvalid(o, '1.5')).toBe(true);
        expect(audioLengthInvalid(o, '45')).toBe(false);
        expect(settingsInputs(o, { seed: '', negative: '', aspect: null, voice: 'v', audioSeconds: '45' }).duration).toBe(45);
        expect(settingsInputs(o, { seed: '', negative: '', aspect: null, voice: 'v' }).duration).toBe(30);
        expect(settingsInputs(o, { seed: '', negative: '', aspect: null, voice: 'v', audioSeconds: '4' }).duration).toBeUndefined();
    });
});
