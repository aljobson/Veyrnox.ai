// The Creator Card (server ADR-0251): a name and three traits worked out from Vibe Check answers. A pure function of the
// answers, so the same answers give the same card here and on the web. This file is the twin of lib/creatorArchetype.js;
// tests/creatorArchetypeParity.test.mjs checks the two agree. It is total: an answer set from another version still
// yields a card. Self-contained (no imports) so that test can load it directly.
export const PACE_NOUNS: Readonly<Record<string, string>> = Object.freeze({ fox: 'Firestarter', owl: 'Finisher', octopus: 'Tinkerer', jellyfish: 'Dreamer' });
export const CHAOS_ADJECTIVES: readonly string[] = Object.freeze(['Careful', 'Midnight', 'Feral']);
export const FALLBACK_NOUN = 'Maker';

export const LOOK_LABELS: Readonly<Record<string, string>> = Object.freeze({
    neon_rain: 'Neon rain', sunlit_kitchen: 'Sunlit kitchen', retro_vhs: 'Retro VHS',
    dream_anime: 'Dream anime', glossy_product: 'Glossy product', doc_grit: 'Documentary grit',
});
export const CHAOS_LABELS: readonly string[] = Object.freeze(['Safe and polished', 'Mostly tidy', 'A little odd', 'Properly weird', 'Absolute chaos']);
export const DESTINATION_LABELS: Readonly<Record<string, string>> = Object.freeze({
    tiktok: 'TikTok', reels: 'Reels', youtube: 'YouTube', cinema: 'Cinema', roll: 'Camera roll',
});

export interface CreatorCard {
    readonly name: string;
    readonly studio: string | null;
    readonly traits: readonly string[];
}

const has = (map: object, key: unknown): key is string => typeof key === 'string' && Object.hasOwn(map, key);

// 0-1 careful, 2 midnight, 3-4 feral. Anything else is treated as the middle.
export function chaosBand(chaos: unknown): 0 | 1 | 2 {
    if (typeof chaos !== 'number' || !Number.isInteger(chaos) || chaos < 0 || chaos > 4) return 1;
    return chaos <= 1 ? 0 : chaos === 2 ? 1 : 2;
}

type Loose = Record<string, unknown>;
const asObject = (a: unknown): Loose => (a && typeof a === 'object' ? (a as Loose) : {});

export function archetypeName(answers: unknown): string {
    const a = asObject(answers);
    const noun = has(PACE_NOUNS, a.pace) ? PACE_NOUNS[a.pace] : FALLBACK_NOUN;
    return `The ${CHAOS_ADJECTIVES[chaosBand(a.chaos)]} ${noun}`;
}

export function creatorCard(answers: unknown): CreatorCard {
    const a = asObject(answers);
    const chaos = typeof a.chaos === 'number' && Number.isInteger(a.chaos) && a.chaos >= 0 && a.chaos <= 4 ? a.chaos : 2;
    const studio = typeof a.studio_name === 'string' && a.studio_name.trim() ? a.studio_name.trim() : null;
    const traits = [
        has(LOOK_LABELS, a.look) ? LOOK_LABELS[a.look] : null,
        CHAOS_LABELS[chaos],
        has(DESTINATION_LABELS, a.destination) ? DESTINATION_LABELS[a.destination] : null,
    ].filter((x): x is string => x !== null);
    return { name: archetypeName(a), studio, traits };
}
