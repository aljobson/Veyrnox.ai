import * as SecureStore from 'expo-secure-store';
import type { ApiClient, ClientTask } from './api';
import type { StoredFirstGoal } from './firstGoal';
import { writeFirstGoal } from './firstGoalStore';
import type { StoredDestination, StoredRole } from './firstProfile';
import { writeFirstProfile } from './firstProfileStore';
import { pushFirstAnswers } from './firstProfileSync';
import { replayFirstOnboarding, writeFirstOnboarding } from './firstProfileStore';

// Personalisation happens before authentication. This record contains only three fixed-choice words; never a prompt,
// file, email address or credential. `completed` keeps returning signed-out people out of the quiz, while `pending`
// means the answers still belong to the next account that signs in on this phone.
export const PRE_AUTH_ONBOARDING_VERSION = 1;
export const PRE_AUTH_ONBOARDING_SLOT = `veyrnox.preAuthOnboarding.v${PRE_AUTH_ONBOARDING_VERSION}`;

export interface PreAuthAnswers {
    readonly role: StoredRole | null;
    readonly goal: StoredFirstGoal | null;
    readonly destination: StoredDestination | null;
}

export interface PreAuthOnboarding extends PreAuthAnswers {
    readonly completed: boolean;
    readonly pending: boolean;
    readonly resume: 'sign-in' | 'preview';
}

const EMPTY: PreAuthOnboarding = { role: null, goal: null, destination: null, completed: false, pending: false, resume: 'sign-in' };
const ROLES = new Set(['creator', 'business', 'pro', 'hobbyist', 'beginner', 'skipped']);
const GOALS = new Set(['image', 'video', 'audio', 'edit', 'publish', 'unsure', 'skipped']);
const DESTINATIONS = new Set(['tiktok', 'reels', 'youtube', 'private', 'skipped']);

export function parsePreAuthOnboarding(raw: string | null | undefined): PreAuthOnboarding {
    if (!raw) return EMPTY;
    try {
        const value = JSON.parse(raw) as Record<string, unknown> | null;
        if (!value || Array.isArray(value) || value.version !== PRE_AUTH_ONBOARDING_VERSION) return EMPTY;
        const role = typeof value.role === 'string' && ROLES.has(value.role) ? value.role as StoredRole : null;
        const goal = typeof value.goal === 'string' && GOALS.has(value.goal) ? value.goal as StoredFirstGoal : null;
        const destination = typeof value.destination === 'string' && DESTINATIONS.has(value.destination) ? value.destination as StoredDestination : null;
        return {
            role,
            goal,
            destination,
            completed: value.completed === true,
            pending: value.pending === true,
            resume: value.resume === 'preview' ? 'preview' : 'sign-in',
        };
    } catch {
        return EMPTY;
    }
}

async function write(value: PreAuthOnboarding): Promise<void> {
    await SecureStore.setItemAsync(PRE_AUTH_ONBOARDING_SLOT, JSON.stringify({ version: PRE_AUTH_ONBOARDING_VERSION, ...value })).catch(() => undefined);
}

export async function readPreAuthOnboarding(): Promise<PreAuthOnboarding> {
    return parsePreAuthOnboarding(await SecureStore.getItemAsync(PRE_AUTH_ONBOARDING_SLOT).catch(() => null));
}

export async function savePreAuthAnswers(answers: Partial<PreAuthAnswers>): Promise<PreAuthOnboarding> {
    const current = await readPreAuthOnboarding();
    const next = { ...current, ...answers, completed: false, pending: false };
    await write(next);
    return next;
}

export async function completePreAuthOnboarding(answers: PreAuthAnswers, resume: 'sign-in' | 'preview'): Promise<void> {
    await write({ ...answers, completed: true, pending: true, resume });
}

// A returning person may go straight to sign-in from the opening screen. Remember that choice without claiming any
// answers for the next account; the caller also retires the legacy post-sign-in welcome so onboarding is not repeated.
export async function skipPreAuthOnboarding(): Promise<void> {
    const current = await readPreAuthOnboarding();
    await write({ ...current, completed: true, pending: false, resume: 'sign-in' });
}

// Looking around is a complete signed-out path, not a temporary detour to account creation. Keep any answers already
// chosen, but claim them for a future account only when the full result exists.
export async function browsePreAuthOnboarding(): Promise<void> {
    const current = await readPreAuthOnboarding();
    const hasResult = !!current.role && !!current.goal && !!current.destination;
    await write({ ...current, completed: true, pending: hasResult, resume: 'preview' });
}

export async function hasCompletedPreAuthOnboarding(): Promise<boolean> {
    return (await readPreAuthOnboarding()).completed;
}

// Called only after authentication. Copy the three fixed choices into the account-backed stores and endpoint, then
// retire the pending claim. The operation is safe to repeat if the app closes between writes.
export async function applyPendingPreAuthOnboarding(api: Pick<ApiClient, 'request'>, task?: ClientTask): Promise<boolean> {
    const current = await readPreAuthOnboarding();
    if (!current.completed || !current.pending) return false;
    await Promise.all([
        current.goal ? writeFirstGoal(current.goal) : Promise.resolve(),
        writeFirstProfile({ role: current.role, destination: current.destination }),
        pushFirstAnswers(api, {
            ...(current.role ? { role: current.role } : {}),
            ...(current.goal ? { goal: current.goal } : {}),
            ...(current.destination ? { destination: current.destination } : {}),
        }),
    ]);
    if (task?.user && task.current()) {
        // Retire the older account onboarding as part of the same handoff. A pending replay keeps an offline or
        // interrupted completion from asking the same three questions again on a later launch.
        const account = {
            goal: current.goal,
            role: current.role,
            destination: current.destination,
            version: 1 as const,
            currentStep: 'recap' as const,
            completed: false,
            pending: true,
            completeRequested: true,
        };
        await writeFirstOnboarding(task.user, account, task);
        if (!task.current()) return false;
        void replayFirstOnboarding(api, task, account);
    }
    await write({ ...current, pending: false, resume: 'sign-in' });
    return true;
}
