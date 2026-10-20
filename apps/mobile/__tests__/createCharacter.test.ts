import { DEFAULT_CINEMA, buildCinemaPrompt, cinemaSuffix } from '../src/lib/cinemaCamera';
import { SAVED_DRAFT_VERSION, parseDraft } from '../src/lib/createOptions';
import { buildCharacterPrompt, changePick, characterTraits } from '../src/lib/oddlingsBuilder';

const draft = { v: SAVED_DRAFT_VERSION, modelId: 'm', prompt: 'a portrait', duration: null, aspect: null, count: 1, seed: '', negative: '' };

describe('Character in Create', () => {
    test('the traits become words in the prompt, with the person\'s own words last', () => {
        const picks = changePick({}, 'character_type', 'Human');
        const out = buildCharacterPrompt('in a garden', picks);
        expect(out.startsWith('Portrait of an original adult character, not a real person')).toBe(true);
        for (const trait of characterTraits(picks)) expect(out).toContain(trait);
        expect(out.endsWith('in a garden')).toBe(true);
    });
    test('character first, then the camera: the result still fits and ends with the camera', () => {
        const base = buildCharacterPrompt('x'.repeat(5000), changePick({}, 'character_type', 'Human'));
        const out = buildCinemaPrompt(base, DEFAULT_CINEMA);
        expect(out.length).toBeLessThanOrEqual(2000);
        expect(out.endsWith(cinemaSuffix(DEFAULT_CINEMA))).toBe(true);
    });
    test('the draft keeps the choice and drops anything that is not a known option', () => {
        const back = parseDraft({ ...draft, characterOn: true, character: { character_type: 'Human', hair: 'not an option', evil: 'x' } }, 'm');
        expect(back?.characterOn).toBe(true);
        expect(back?.character).toEqual({ character_type: 'Human' });
    });
    test('a draft from before the panel reads back with it off', () => {
        const back = parseDraft(draft, 'm');
        expect(back?.characterOn).toBe(false);
        expect(back?.character).toEqual({});
    });
});
