// The Vibe Check answer allowlist (server ADR-0251, migration 0363, lib/creatorProfile.js). Self-contained on purpose:
// tests/creatorArchetypeParity.test.mjs imports this file and the web copy and checks they list the same values.
export const CREATOR_ANSWERS = {
    look: ['neon_rain', 'sunlit_kitchen', 'retro_vhs', 'dream_anime', 'glossy_product', 'doc_grit'],
    goal: ['sell', 'story', 'music_video', 'meme', 'character', 'bedtime'],
    pace: ['fox', 'owl', 'octopus', 'jellyfish'],
    destination: ['tiktok', 'reels', 'youtube', 'cinema', 'roll'],
    audience: ['me', 'audience', 'customers', 'kids', 'nobody_yet'],
    voice: ['hype', 'calm', 'straight'],
} as const;
export const CHAOS_MAX = 4;
export const STUDIO_NAME_MAX = 40;

export type Look = (typeof CREATOR_ANSWERS.look)[number];
export type Goal = (typeof CREATOR_ANSWERS.goal)[number];
export type Pace = (typeof CREATOR_ANSWERS.pace)[number];
export type Destination = (typeof CREATOR_ANSWERS.destination)[number];
export type Audience = (typeof CREATOR_ANSWERS.audience)[number];
export type Voice = (typeof CREATOR_ANSWERS.voice)[number];

// A full, valid answer set as the server stores it.
export interface CreatorAnswers {
    readonly look: Look;
    readonly goal: Goal;
    readonly pace: Pace;
    readonly chaos: number;
    readonly destination: Destination;
    readonly audience: Audience;
    readonly voice: Voice;
    readonly studio_name?: string;
}

// True only for a complete set with every value on its list: what is read back from the server or the phone's store
// is checked before it steers anything.
export function isCreatorAnswers(value: unknown): value is CreatorAnswers {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const v = value as Record<string, unknown>;
    for (const [key, list] of Object.entries(CREATOR_ANSWERS)) {
        if (typeof v[key] !== 'string' || !(list as readonly string[]).includes(v[key] as string)) return false;
    }
    if (!Number.isInteger(v.chaos) || (v.chaos as number) < 0 || (v.chaos as number) > CHAOS_MAX) return false;
    return v.studio_name === undefined || (typeof v.studio_name === 'string' && v.studio_name.length <= STUDIO_NAME_MAX);
}
