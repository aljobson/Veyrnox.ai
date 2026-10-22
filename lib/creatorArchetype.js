/**
 * The Creator Card (ADR-0251): a name and three traits worked out from Vibe Check
 * answers. A pure function of the answers, so the same answers always give the same
 * card on web and mobile and nothing about it is stored (migration 0363 keeps only
 * the answers). The mobile twin, apps/mobile/src/lib/creatorArchetype.ts, must stay
 * identical; tests/creatorArchetype.test.mjs checks both.
 *
 * Total on purpose: an answer set from an older version, or one with a value this
 * build does not know, still yields a card rather than throwing.
 */

// Pace picks the noun, chaos picks the adjective: 4 x 3 = 12 names.
export const PACE_NOUNS = Object.freeze({ fox: 'Firestarter', owl: 'Finisher', octopus: 'Tinkerer', jellyfish: 'Dreamer' });
export const CHAOS_ADJECTIVES = Object.freeze(['Careful', 'Midnight', 'Feral']);
export const FALLBACK_NOUN = 'Maker';

// Labels for the card's chips; every allowlisted value has one (the test checks).
export const LOOK_LABELS = Object.freeze({
    neon_rain: 'Neon rain', sunlit_kitchen: 'Sunlit kitchen', retro_vhs: 'Retro VHS',
    dream_anime: 'Dream anime', glossy_product: 'Glossy product', doc_grit: 'Documentary grit',
});
export const CHAOS_LABELS = Object.freeze(['Safe and polished', 'Mostly tidy', 'A little odd', 'Properly weird', 'Absolute chaos']);
export const DESTINATION_LABELS = Object.freeze({
    tiktok: 'TikTok', reels: 'Reels', youtube: 'YouTube', cinema: 'Cinema', roll: 'Camera roll',
});

/** 0-1 careful, 2 midnight, 3-4 feral. Anything else is treated as the middle. */
export function chaosBand(chaos) {
    if (!Number.isInteger(chaos) || chaos < 0 || chaos > 4) return 1;
    return chaos <= 1 ? 0 : chaos === 2 ? 1 : 2;
}

/**
 * The pieces of the card, for a screen that words them from its own catalog (the web does, so the name reads right in
 * every language): which adjective, which noun (null = the fallback), and which look and destination labels apply.
 */
export function archetypeParts(answers) {
    const a = answers && typeof answers === 'object' ? answers : {};
    const chaos = Number.isInteger(a.chaos) && a.chaos >= 0 && a.chaos <= 4 ? a.chaos : 2;
    return {
        adjective: chaosBand(a.chaos),
        pace: Object.hasOwn(PACE_NOUNS, a.pace) ? a.pace : null,
        look: typeof a.look === 'string' && Object.hasOwn(LOOK_LABELS, a.look) ? a.look : null,
        chaos,
        destination: typeof a.destination === 'string' && Object.hasOwn(DESTINATION_LABELS, a.destination) ? a.destination : null,
        studio: typeof a.studio_name === 'string' && a.studio_name.trim() ? a.studio_name.trim() : null,
    };
}

export function archetypeName(answers) {
    const a = answers && typeof answers === 'object' ? answers : {};
    const noun = Object.hasOwn(PACE_NOUNS, a.pace) ? PACE_NOUNS[a.pace] : FALLBACK_NOUN;
    return `The ${CHAOS_ADJECTIVES[chaosBand(a.chaos)]} ${noun}`;
}

export function creatorCard(answers) {
    const a = answers && typeof answers === 'object' ? answers : {};
    const chaos = Number.isInteger(a.chaos) && a.chaos >= 0 && a.chaos <= 4 ? a.chaos : 2;
    const pick = (map, key) => (typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : null);
    return {
        name: archetypeName(a),
        studio: typeof a.studio_name === 'string' && a.studio_name.trim() ? a.studio_name.trim() : null,
        traits: [pick(LOOK_LABELS, a.look), CHAOS_LABELS[chaos], pick(DESTINATION_LABELS, a.destination)].filter(Boolean),
    };
}
