import type { CreatorAnswers } from '../src/lib/creatorAnswers';
import { defaultAspect, rankPresets, tastePicks, tasteScore } from '../src/lib/creatorTaste';
import type { Preset } from '../src/lib/presets';

const answers: CreatorAnswers = { look: 'neon_rain', goal: 'sell', pace: 'fox', chaos: 2, destination: 'tiktok', audience: 'customers', voice: 'calm' };
const preset = (id: string, title: string, over: Partial<Preset> = {}): Preset => ({
    id, title, category: 'GENERAL', modelId: 'm', modelName: 'M', modality: 'text-to-video', prompt: 'a scene', needs: null,
    durationSeconds: 5, credits: 10, available: true, isNew: false, previewUrl: null, posterUrl: 'https://x.test/p.jpg', ...over,
});

describe('ranking templates for the vibe check answers', () => {
    const list = [preset('a', 'Quiet lake'), preset('b', 'Product spin on a pedestal'), preset('c', 'Meme reaction'), preset('d', 'Neon product ad')];

    test('with no answers nothing moves', () => {
        expect(rankPresets(list, null).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
        expect(tastePicks(list, null).map((p) => p.id)).toEqual(tastePicks(list, null).map((p) => p.id));
    });

    test('templates that fit the goal and look go first; ties keep the server order', () => {
        expect(rankPresets(list, answers).map((p) => p.id)).toEqual(['d', 'b', 'a', 'c']);
        expect(rankPresets(list, { ...answers, goal: 'meme', look: 'doc_grit' }).map((p) => p.id)).toEqual(['c', 'a', 'b', 'd']);
    });

    test('it never drops, adds or changes a template', () => {
        const ranked = rankPresets(list, answers);
        expect(ranked).toHaveLength(list.length);
        expect(new Set(ranked)).toEqual(new Set(list));
        expect(list.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    test('available templates lead unavailable matches without removing them', () => {
        const ranked = rankPresets([preset('off', 'Neon product ad', { available: false }), preset('on', 'Quiet lake')], answers);
        expect(ranked.map((p) => p.id)).toEqual(['on', 'off']);
    });

    test('score counts a few words, not a flood of them', () => {
        const stuffed = preset('s', 'product product ad brand sale shop commercial neon rain cyber night');
        expect(tasteScore(stuffed, answers)).toBe(3 * 2 + 1 * 2);
    });
});

describe('the lead templates on home', () => {
    test('fitting templates lead, then the usual picks fill the row', () => {
        const list = [
            preset('a', 'Quiet lake', { category: 'NATURE' }),
            preset('b', 'Sunset', { category: 'NATURE', isNew: true }),
            preset('c', 'Product spin', { category: 'ADS' }),
            preset('d', 'Product spin from a photo', { category: 'ADS2', needs: 'image' }),
        ];
        const picks = tastePicks(list, answers, 3).map((p) => p.id);
        // Equal fit: the one that starts from words alone leads the one that first asks for a photo.
        expect(picks.slice(0, 2)).toEqual(['c', 'd']);
        expect(picks).toHaveLength(3);
        expect(new Set(picks).size).toBe(3);
    });

    test('a template with no picture, and audio, are never led with', () => {
        const list = [preset('a', 'Product jingle', { modality: 'text-to-audio' }), preset('b', 'Product shot', { posterUrl: null }), preset('off', 'Neon product ad', { available: false }), preset('c', 'Quiet lake')];
        expect(tastePicks(list, answers, 3).map((p) => p.id)).toEqual(['c']);
    });
});

describe('the aspect ratio a model opens on', () => {
    test('the destination wins when the model offers it', () => {
        expect(defaultAspect(['16:9', '9:16', '1:1'], answers)).toBe('9:16');
        expect(defaultAspect(['16:9', '9:16'], { destination: 'youtube' })).toBe('16:9');
    });

    test('otherwise today\'s rule holds', () => {
        expect(defaultAspect(['16:9', '1:1'], answers)).toBe('16:9');
        expect(defaultAspect(['1:1', '4:3'], answers)).toBe('1:1');
        expect(defaultAspect(['1:1', '16:9'], null)).toBe('16:9');
        expect(defaultAspect(['1:1'], { destination: 'roll' })).toBe('1:1');
        expect(defaultAspect([], answers)).toBeNull();
    });
});
