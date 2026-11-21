// First-run personal answers (ADR-0339): role and destination, beside the goal (firstGoal.ts). One fixed word each (or
// "skipped"); never free text, never in a URL. They only order and pre-fill screens: no price, model or access.
// Mirrors app/veyrnox/_lib/firstProfile.js; __tests__/firstProfile.test.ts checks the two agree.
import { FILM_STUDIO_ENABLED } from './filmStudioSwitch';
import { FIRST_GOALS, type StoredFirstGoal } from './firstGoal';
export const FIRST_PROFILE_VERSION = 1;
export const FIRST_PROFILE_SLOT = `veyrnox.firstProfile.v${FIRST_PROFILE_VERSION}`;
export const FIRST_ONBOARDING_VERSION = 1;
export const FIRST_ONBOARDING_SLOT = 'veyrnox.firstOnboarding.v1';
export const FIRST_ONBOARDING_STEPS = ['goal', 'destination', 'role', 'recap'] as const;
export type FirstOnboardingStep = (typeof FIRST_ONBOARDING_STEPS)[number];

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
export interface FirstAnswers extends FirstProfile { readonly goal: StoredFirstGoal | null }
export interface FirstOnboarding extends FirstAnswers {
    readonly version: 0 | 1;
    readonly currentStep: FirstOnboardingStep | null;
    readonly completed: boolean;
}

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

export function readRemoteFirstOnboarding(body: unknown): Pick<FirstOnboarding, 'version' | 'currentStep' | 'completed'> | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const { version, current_step: currentStep = null, completed } = body as { version?: unknown; current_step?: unknown; completed?: unknown };
    if ((version !== 0 && version !== 1) || typeof completed !== 'boolean') return null;
    if (completed ? currentStep !== null : typeof currentStep !== 'string' || !(FIRST_ONBOARDING_STEPS as readonly string[]).includes(currentStep)) return null;
    return { version, currentStep: currentStep as FirstOnboardingStep | null, completed };
}

export function serializeFirstOnboarding(owner: string, state: FirstOnboarding): string {
    if (!owner) throw new Error('invalid onboarding owner');
    return JSON.stringify({ owner, version: state.version, goal: state.goal, role: state.role, destination: state.destination,
        currentStep: state.currentStep, completed: state.completed });
}

export function parseFirstOnboarding(raw: string | null | undefined, owner: string | null | undefined): FirstOnboarding | null {
    if (!raw || !owner) return null;
    try {
        const value = JSON.parse(raw) as Record<string, unknown>;
        if (!value || Array.isArray(value) || value.owner !== owner) return null;
        const progress = readRemoteFirstOnboarding({ version: value.version, current_step: value.currentStep, completed: value.completed });
        const profile = readRemoteFirstProfile(value);
        const goalIds = new Set<string>([...FIRST_GOALS, 'skipped']);
        const goal = value.goal == null ? null : typeof value.goal === 'string' && goalIds.has(value.goal) ? value.goal as StoredFirstGoal : null;
        if (!progress || profile.kind !== 'profile' || (value.goal != null && goal === null)) return null;
        return { goal, role: profile.role, destination: profile.destination, ...progress };
    } catch { return null; }
}

// Asked only of someone with no goal and no role on record, so an account that answered before is never asked again.
export const needsFirstRun = ({ goal = null, role: r = null, completed }: { readonly goal?: string | null; readonly role?: string | null; readonly completed?: boolean } = {}): boolean =>
    typeof completed === 'boolean' ? !completed : goal === null && r === null;

export const hasRealAnswer = (a: { readonly goal?: string | null; readonly role?: string | null; readonly destination?: string | null } | null): boolean =>
    !!a && [a.goal, a.role, a.destination].some((word) => !!word && word !== 'skipped' && word !== 'unsure');

// Home start options in the order this person should see them. Goal puts its own area first; no answer keeps the default.
// The web has four keys; the phone home shows create, audio, chat and film (Instruments always stays last), so it filters.
export type StartKey = 'create' | 'audio' | 'chat' | 'film' | 'smart-cut';
const START_ORDER: Record<FirstRole, readonly StartKey[]> = {
    creator: ['create', 'audio', 'smart-cut', 'film', 'chat'],
    business: ['create', 'film', 'audio', 'chat', 'smart-cut'],
    pro: ['film', 'create', 'audio', 'smart-cut', 'chat'],
    hobbyist: ['create', 'audio', 'film', 'chat', 'smart-cut'],
    beginner: ['create', 'audio', 'chat', 'film', 'smart-cut'],
};
const DEFAULT_STARTS: readonly StartKey[] = ['create', 'audio', 'chat', 'film', 'smart-cut'];
const GOAL_START: Readonly<Record<string, StartKey>> = { video: 'film', audio: 'audio', edit: 'smart-cut' };

export function orderStarts(r: string | null | undefined, goal: string | null | undefined): StartKey[] {
    const base = (r && Object.prototype.hasOwnProperty.call(START_ORDER, r) ? START_ORDER[r as FirstRole] : DEFAULT_STARTS) as readonly StartKey[];
    const first = goal ? GOAL_START[goal] : undefined;
    return first ? [first, ...base.filter((key) => key !== first)] : [...base];
}
export const phoneStarts = (r: string | null | undefined, goal: string | null | undefined): ('create' | 'audio' | 'chat' | 'film')[] =>
    orderStarts(r, goal).filter((key): key is 'create' | 'audio' | 'chat' | 'film' => key !== 'smart-cut' && (FILM_STUDIO_ENABLED || key !== 'film'));

// "work" examples (product, ad and brand ideas) for creator, business and pro; the everyday ones for everyone else.
export const exampleSetFor = (r: string | null | undefined): 'work' | 'everyday' => (r === 'creator' || r === 'business' || r === 'pro' ? 'work' : 'everyday');

// The starting aspect ratio on Create. "Just for me" and skipped change nothing, so the form keeps its own default.
const ASPECT: Readonly<Record<string, string>> = { tiktok: '9:16', reels: '9:16', youtube: '16:9' };
export const defaultAspectFor = (d: string | null | undefined): string | null => (typeof d === 'string' && Object.prototype.hasOwnProperty.call(ASPECT, d) ? ASPECT[d] : null);
