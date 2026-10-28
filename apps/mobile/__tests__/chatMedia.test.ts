import { byPrice, chatMediaModels, cleanMediaPrompt, makeReady, makePrice, MAX_MEDIA_PROMPT, supportedDuration } from '../src/lib/chatMedia';
import type { CatalogModel } from '../src/lib/media';

const m = (id: string, modality: string, credits: number, extra: Partial<CatalogModel> = {}, media: Record<string, { required?: boolean }> = {}): CatalogModel => ({
    id, name: id.toUpperCase(), modality, credits, gated: false, durations: [], capabilities: { inputs: { prompt: { max: 2000 } }, media }, ...extra,
});
const catalog = [
    m('img-b', 'text-to-image', 4),
    m('img-a', 'text-to-image', 2),
    m('img-edit', 'image-to-image', 3, {}, { image: { required: true } }),
    m('img-locked', 'text-to-image', 1, { gated: true }),
    m('vid', 'text-to-video', 10, { durations: [5, 10] }),
    m('vid-i2v', 'image-to-video', 8, { durations: [5] }, { image: { required: true } }),
    m('voice', 'text-to-speech', 1),
    m('topic-only', 'text-to-video', 5, { capabilities: { inputs: { topic: {} }, media: {} } }),
];

describe('models the chat can start', () => {
    test('open prompt models, including required sources, of the chosen kind', () => {
        expect(chatMediaModels(catalog, 'image').map((x) => x.id).sort()).toEqual(['img-a', 'img-b', 'img-edit']);
        expect(chatMediaModels(catalog, 'video').map((x) => x.id)).toEqual(['vid', 'vid-i2v']);
        expect(chatMediaModels(catalog, 'audio').map((x) => x.id)).toEqual(['voice']);
    });
    test('the cheapest comes first', () => {
        expect(byPrice(chatMediaModels(catalog, 'image')).map((x) => x.id)).toEqual(['img-a', 'img-edit', 'img-b']);
    });
});

describe('price and length', () => {
    const vid = catalog[4];
    test('a video is priced by the length chosen, 5 seconds per unit', () => {
        expect(makePrice(vid, 5)).toBe(10);
        expect(makePrice(vid, 10)).toBe(20);
        expect(makePrice(vid, 7)).toBe(10); // an unsupported length falls to the first option
    });
    test('an image or sound has no length', () => {
        expect(supportedDuration(catalog[1], 10)).toBeNull();
        expect(makePrice(catalog[1], 10)).toBe(2);
    });
    test('the words are trimmed and capped', () => {
        expect(cleanMediaPrompt('  hi  ')).toBe('hi');
        expect(cleanMediaPrompt('x'.repeat(MAX_MEDIA_PROMPT + 50))).toHaveLength(MAX_MEDIA_PROMPT);
    });
});

describe('readiness shares Create validation', () => {
    const opts = { seed: '', voice: '', audioSeconds: '' };
    const refs = [{ slot: 'image' as const, origin: 'asset' as const, asset_id: 'asset' }];
    test('required sources and rights are necessary', () => {
        expect(makeReady(catalog[2], '', [], true, false, opts)).toBe(false);
        expect(makeReady(catalog[2], '', refs, false, false, opts)).toBe(false);
        expect(makeReady(catalog[2], '', refs, true, false, opts)).toBe(true);
        expect(makeReady(catalog[2], '', refs, true, true, opts)).toBe(false);
        expect(makeReady(catalog[2], '', [...refs, ...refs], true, false, opts)).toBe(false);
    });
    test('voice, seed, audio length and required words must be valid', () => {
        const voice = m('speech', 'text-to-speech', 1, { capabilities: { inputs: { prompt: {}, voice_description: {}, duration: { type: 'int', min: 1, max: 20 } } } });
        expect(makeReady(voice, 'words', [], false, false, opts)).toBe(false);
        expect(makeReady(voice, 'words', [], false, false, { ...opts, voice: 'warm' })).toBe(true);
        expect(makeReady(voice, '', [], false, false, { ...opts, voice: 'warm' })).toBe(false);
        expect(makeReady(voice, 'words', [], false, false, { ...opts, voice: 'warm', seed: '-1' })).toBe(false);
        expect(makeReady(voice, 'words', [], false, false, { ...opts, voice: 'warm', audioSeconds: '21' })).toBe(false);
    });
});
