// First-run personal answers (ADR-0339): role and destination, beside the goal (firstGoal.ts). One fixed word each (or
// "skipped"); never free text, never in a URL. They only order and pre-fill screens: no price, model or access.
// Mirrors app/veyrnox/_lib/firstProfile.js; __tests__/firstProfile.test.ts checks the two agree.
export const FIRST_PROFILE_VERSION = 1;
export const FIRST_PROFILE_SLOT = `veyrnox.firstProfile.v${FIRST_PROFILE_VERSION}`;

export const FIRST_ROLES = ['creator', 'business', 'pro', 'hobbyist', 'beginner'] as const;
export const FIRST_DESTINATIONS = ['tiktok', 'reels', 'youtube', 'private'] as const;
export type FirstRole = (typeof FIRST_ROLES)[number];
export type FirstDestination = (typeof FIRST_DESTINATIONS)[number];
export type StoredRole = FirstRole | 'skipped';
export type StoredDestination = FirstDestination | 'skipped';

const ROLE_IDS: ReadonlySet<string> = new Set<string>([...FIRST_ROLES, 'skipped']);
const DESTINATION_IDS: ReadonlySet<string> = new Set<string>([...FIRST_DESTINATIONS, 'skipped']);
const role = (value: unknown): StoredRole | null => (typeof value === 'string' && ROLE_IDS.has(value) ? (value as StoredRole) : null);
const destination = (value: unknown): StoredDestination | null => (typeof value === 'string' && DESTINATION_IDS.has(value) ? (value as StoredDestination) : null);

export interface FirstProfile { readonly role: StoredRole | null; readonly destination: StoredDestination | null }
export interface FirstAnswers extends FirstProfile { readonly goal: string | null }

export function serializeFirstProfile({ role: r = null, destination: d = null }: Partial<FirstProfile> = {}): string {
    if ((r !== null && !ROLE_IDS.has(r)) || (d !== null && !DESTINATION_IDS.has(d))) throw new Error('unknown first-run answer');
    return JSON.stringify({ version: FIRST_PROFILE_VERSION, role: r, destination: d });
}

// Anything unreadable, from another version, or off the list reads as "never chose".
export function parseFirstProfile(raw: string | null | undefined): FirstProfile {
    const none: FirstProfile = { role: null, destination: null };
    if (!raw) return none;
    try {
        const value = JSON.parse(raw) as { version?: unknown; role?: unknown; destination?: unknown } | null;
        if (!value || Array.isArray(value) || value.version !== FIRST_PROFILE_VERSION) return none;
        return { role: role(value.role), destination: destination(value.destination) };
    } catch {
        return none;
    }
}

// What the server said (GET /api/v1/first-goal). A server that sends no role yet means "none"; an unlisted word is unreadable.
export type RemoteFirstProfile = ({ readonly kind: 'profile' } & FirstProfile) | { readonly kind: 'unavailable' };
export function readRemoteFirstProfile(body: unknown): RemoteFirstProfile {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { kind: 'unavailable' };
    const { role: r = null, destination: d = null } = body as { role?: unknown; destination?: unknown };
    if ((r !== null && role(r) === null) || (d !== null && destination(d) === null)) return { kind: 'unavailable' };
    return { kind: 'profile', role: r as StoredRole | null, destination: d as StoredDestination | null };
}

// Asked only of someone with no goal and no role on record, so an account that answered before is never asked again.
export const needsFirstRun = ({ goal = null, role: r = null }: { readonly goal?: string | null; readonly role?: string | null } = {}): boolean => goal === null && r === null;

export const hasRealAnswer = (a: { readonly goal?: string | null; readonly role?: string | null; readonly destination?: string | null } | null): boolean =>
    !!a && [a.goal, a.role, a.destination].some((word) => !!word && word !== 'skipped' && word !== 'unsure');

// Home start options in the order this person should see them. Goal puts its own area first; no answer keeps the default.
// The web has four keys; the phone home shows create, chat and film (Instruments always stays last), so it filters.
export type StartKey = 'create' | 'chat' | 'film' | 'smart-cut';
const START_ORDER: Record<FirstRole, readonly StartKey[]> = {
    creator: ['create', 'smart-cut', 'film', 'chat'],
    business: ['create', 'film', 'chat', 'smart-cut'],
    pro: ['film', 'create', 'smart-cut', 'chat'],
    hobbyist: ['create', 'film', 'chat', 'smart-cut'],
    beginner: ['create', 'chat', 'film', 'smart-cut'],
};
const DEFAULT_STARTS: readonly StartKey[] = ['create', 'chat', 'film', 'smart-cut'];
const GOAL_START: Readonly<Record<string, StartKey>> = { video: 'film', edit: 'smart-cut' };

export function orderStarts(r: string | null | undefined, goal: string | null | undefined): StartKey[] {
    const base = (r && Object.prototype.hasOwnProperty.call(START_ORDER, r) ? START_ORDER[r as FirstRole] : DEFAULT_STARTS) as readonly StartKey[];
    const first = goal ? GOAL_START[goal] : undefined;
    return first ? [first, ...base.filter((key) => key !== first)] : [...base];
}
export const phoneStarts = (r: string | null | undefined, goal: string | null | undefined): ('create' | 'chat' | 'film')[] =>
    orderStarts(r, goal).filter((key): key is 'create' | 'chat' | 'film' => key !== 'smart-cut');

// "work" examples (product, ad and brand ideas) for creator, business and pro; the everyday ones for everyone else.
export const exampleSetFor = (r: string | null | undefined): 'work' | 'everyday' => (r === 'creator' || r === 'business' || r === 'pro' ? 'work' : 'everyday');

// The starting aspect ratio on Create. "Just for me" and skipped change nothing, so the form keeps its own default.
const ASPECT: Readonly<Record<string, string>> = { tiktok: '9:16', reels: '9:16', youtube: '16:9' };
export const defaultAspectFor = (d: string | null | undefined): string | null => (typeof d === 'string' && Object.prototype.hasOwnProperty.call(ASPECT, d) ? ASPECT[d] : null);
