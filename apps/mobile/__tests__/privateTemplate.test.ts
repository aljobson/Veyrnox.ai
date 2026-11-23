import { fetchPrivatePrompt, withTemplateWords } from '../src/lib/privateTemplate';
import { parsePresets } from '../src/lib/presets';
import { readTemplateSource } from '../src/lib/templateSourceCache';
import { phonePhotoHints } from '../src/lib/templatePhotoHintText';
import { phoneHints } from '../../../lib/templatePhotoHintAround';
import { templatePromptPlaceholder } from '../../../lib/templatePromptPlaceholder';

// ADR-0351 amendment 23: with templatePromptsPrivate on the feed carries a placeholder; Edit prompt reads the words for the signed-in person.
const words = 'Animate the uploaded photo into a slow, cinematic push-in with warm light.';
const feed = { id: 'pet-demo', title: 'Pet demo', category: 'PET', modelId: 'kling-3.0-i2v', modelName: 'Kling 3.0', modality: 'image-to-video',
    prompt: templatePromptPlaceholder('pet-demo'), promptOrigin: 'community-source-exact', sourcePrompt: templatePromptPlaceholder('pet-demo'),
    sourcePromptOrigin: 'community-source-exact', sourcePromptStatus: 'exact', promptPrivate: true, needs: null, durationSeconds: 5, credits: 40, available: true, isNew: false, previewUrl: null, posterUrl: null };
const detail = { id: 'pet-demo', prompt: words, sourcePrompt: words, sourcePromptOrigin: 'community-source-exact' };
const fakeApi = (answer: unknown, ok = true) => ({ request: jest.fn(async (path: string) => { if (!ok) throw new Error('401'); return answer; }), stream: jest.fn(), getBalance: jest.fn() });

describe('a private video template on the phone', () => {
    it('keeps the placeholder and the private flag from the feed, and never invents words', () => {
        const [p] = parsePresets({ presets: [feed] });
        expect(p!.prompt).toBe(templatePromptPlaceholder('pet-demo'));
        expect(p!.sourcePrompt).toBe(templatePromptPlaceholder('pet-demo'));
        expect(p!.promptPrivate).toBe(true);
        expect(parsePresets({ presets: [{ ...feed, promptPrivate: undefined, prompt: 'Plain', sourcePrompt: null, sourcePromptOrigin: null }] })[0]!.promptPrivate).toBeUndefined();
    });
    it('Edit prompt reads the words from the signed-in route and replaces the remembered source with the full one', async () => {
        const api = fakeApi({ template: detail });
        const full = await fetchPrivatePrompt(api as never, 'pet-demo');
        expect(api.request).toHaveBeenCalledWith('/api/v1/templates/pet-demo/prompt');
        expect(full).toEqual({ prompt: words, sourcePrompt: words, own: words });
        expect((readTemplateSource('pet-demo') as { sourcePrompt?: string }).sourcePrompt).toBe(words);
    });
    it('answers null, not a placeholder, when signed out, offline, mismatched or malformed', async () => {
        expect(await fetchPrivatePrompt(fakeApi(null, false) as never, 'pet-demo')).toBeNull();
        expect(await fetchPrivatePrompt(fakeApi({ template: { ...detail, id: 'other' } }) as never, 'pet-demo')).toBeNull();
        expect(await fetchPrivatePrompt(fakeApi({ template: { id: 'pet-demo' } }) as never, 'pet-demo')).toBeNull();
        expect(await fetchPrivatePrompt(fakeApi({ template: detail }) as never, 'Bad Id!')).toBeNull();
    });
    it('fills the words in where a placeholder stands, and leaves other text alone', async () => {
        const api = fakeApi({ template: detail });
        expect(await withTemplateWords(api as never, 'my own words')).toBe('my own words');
        expect(api.request).not.toHaveBeenCalled();
        expect(await withTemplateWords(api as never, `${templatePromptPlaceholder('pet-demo')} Slow zoom.`)).toBe(`${words} Slow zoom.`);
        expect(await withTemplateWords(fakeApi(null, false) as never, templatePromptPlaceholder('pet-demo'))).toBeNull();
    });
    it('photo-slot lines come from the server for a private bound template, the same ones the phone would have cut', () => {
        const source = 'Face @image2 here. Hat @image1 there.';
        const map = [{ token: '@image2', slot: 1, offset: 5 }, { token: '@image1', slot: 2, offset: 23 }];
        const full = { class: 'bound', slotCount: 2, sourcePrompt: source, tokenMap: map };
        const hidden = { class: 'bound', slotCount: 2, sourcePrompt: templatePromptPlaceholder('x'), tokenMap: map, photoHintsPhone: phoneHints(full) };
        expect(phonePhotoHints(hidden)).toEqual(phonePhotoHints(full));
        expect(phonePhotoHints(hidden)).toEqual(['Face @image2 here.', 'Hat @image1 there.']);
    });
});
