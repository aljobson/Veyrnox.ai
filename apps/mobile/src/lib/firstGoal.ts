// First visit to Create: "What do you want to make first?" (one question, skippable, asked once per phone). Mirrors
// app/veyrnox/_lib/firstGoal.js on the web; __tests__/firstGoal.test.ts checks both list the same goals. Slice 1 keeps
// the answer on this phone only: a goal id, never a file, a prompt or a key.
export const FIRST_GOAL_VERSION = 1;
export const FIRST_GOAL_SLOT = `veyrnox.firstGoal.v${FIRST_GOAL_VERSION}`;

export const FIRST_GOALS = ['image', 'video', 'audio', 'edit', 'publish', 'unsure'] as const;
// "Not sure yet" shows one example for each of these (same list as the web card).
export const FIRST_GOAL_EXAMPLES = ['image', 'video', 'audio'] as const;
export type FirstGoal = (typeof FIRST_GOALS)[number];
export type StoredFirstGoal = FirstGoal | 'skipped';

const KNOWN: ReadonlySet<string> = new Set<string>([...FIRST_GOALS, 'skipped']);

export type FirstGoalTarget =
    | { readonly kind: 'create'; readonly goal: 'image' | 'video' | 'audio' }
    | { readonly kind: 'tab'; readonly href: '/editor' | '/publish' }
    | { readonly kind: 'stay' };

// Where a goal leads: the starter form for a creation goal, another tab, or nowhere ("not sure" keeps the goal list).
export function firstGoalTarget(goal: string): FirstGoalTarget {
    if (goal === 'image' || goal === 'video' || goal === 'audio') return { kind: 'create', goal };
    if (goal === 'edit') return { kind: 'tab', href: '/editor' };
    if (goal === 'publish') return { kind: 'tab', href: '/publish' };
    return { kind: 'stay' };
}

export function serializeFirstGoal(goal: StoredFirstGoal): string {
    if (!KNOWN.has(goal)) throw new Error('unknown first goal');
    return JSON.stringify({ version: FIRST_GOAL_VERSION, goal });
}

// Anything unreadable, from another version, or off the list reads as "never chose", so the person is simply asked again.
export function parseFirstGoal(raw: string | null | undefined): StoredFirstGoal | null {
    if (!raw) return null;
    try {
        const value = JSON.parse(raw) as { version?: unknown; goal?: unknown } | null;
        if (!value || Array.isArray(value) || value.version !== FIRST_GOAL_VERSION) return null;
        return typeof value.goal === 'string' && KNOWN.has(value.goal) ? (value.goal as StoredFirstGoal) : null;
    } catch {
        return null;
    }
}
