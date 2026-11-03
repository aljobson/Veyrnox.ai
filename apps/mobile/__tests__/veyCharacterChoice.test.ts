import {
    DEFAULT_VEY_CHARACTER, VEY_CHARACTER_IDS, WOBNIMO_CHARACTERS, isWobnimoCharacter, normaliseVeyCharacter,
    parseVeyCharacter, wobnimoStateForMood,
} from '../src/lib/veyCharacterChoice';
import { WOBNIMO_SCRIPT } from '../src/lib/wobnimoBundle.generated';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined) }));

describe('Vey character choice', () => {
    it('is Vey plus the twenty wobnimo mascots', () => {
        expect(DEFAULT_VEY_CHARACTER).toBe('vey');
        expect(WOBNIMO_CHARACTERS).toHaveLength(20);
        expect(new Set(VEY_CHARACTER_IDS).size).toBe(21);
        expect(isWobnimoCharacter('vey')).toBe(false);
        expect(isWobnimoCharacter('mochi')).toBe(true);
    });
    it('falls back to Vey for anything unknown', () => {
        expect(normaliseVeyCharacter('<script>')).toBe('vey');
        expect(parseVeyCharacter(null)).toBe('vey');
        expect(parseVeyCharacter('not json')).toBe('vey');
        expect(parseVeyCharacter('{"version":1,"id":"pip"}')).toBe('pip');
        expect(parseVeyCharacter('{"version":2,"id":"pip"}')).toBe('vey');
    });
    it('maps Vey moods onto wobnimo states', () => {
        expect(wobnimoStateForMood('cheer')).toBe('celebrating');
        expect(wobnimoStateForMood('worried')).toBe('sad');
        expect(wobnimoStateForMood('working')).toBe('working');
        expect(wobnimoStateForMood(undefined)).toBe('idle');
    });
    it('inlines an engine that cannot reach the network or close its own script tag', () => {
        expect(WOBNIMO_SCRIPT).not.toContain('</script');
        expect(WOBNIMO_SCRIPT).not.toMatch(/fetch\(|XMLHttpRequest|https?:\/\//);
        expect(WOBNIMO_SCRIPT).toContain('window.__wobnimo={');
    });
});
