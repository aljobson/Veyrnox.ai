import { byPrice, chatMediaModels, cleanMediaPrompt, makeKeyFor, makePrice, MAX_MEDIA_PROMPT, supportedDuration } from '../src/lib/chatMedia';
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
    test('only open, words-only models of the chosen kind', () => {
        expect(chatMediaModels(catalog, 'image').map((x) => x.id).sort()).toEqual(['img-a', 'img-b']);
        expect(chatMediaModels(catalog, 'video').map((x) => x.id)).toEqual(['vid']);
        expect(chatMediaModels(catalog, 'audio').map((x) => x.id)).toEqual(['voice']);
    });
    test('the cheapest comes first', () => {
        expect(byPrice(chatMediaModels(catalog, 'image')).map((x) => x.id)).toEqual(['img-a', 'img-b']);
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

describe('one charge on a retry', () => {
    test('the same request keeps its key; a different one gets a new key', () => {
        let n = 0;
        const make = () => `k${++n}`;
        const vid = catalog[4];
        const first = makeKeyFor(null, vid, 'a fox', 5, make);
        expect(makeKeyFor(first, vid, 'a fox', 5, make).key).toBe(first.key);
        expect(makeKeyFor(first, vid, 'a fox', 10, make).key).not.toBe(first.key);
        expect(makeKeyFor(first, vid, 'a hare', 5, make).key).not.toBe(first.key);
        expect(makeKeyFor(first, catalog[1], 'a fox', 5, make).key).not.toBe(first.key);
    });
});
