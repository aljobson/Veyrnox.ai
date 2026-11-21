import * as SecureStore from 'expo-secure-store';
import { appStorage } from './appCache';
import type { ApiClient, ClientTask } from './api';
import { FIRST_ONBOARDING_SLOT, FIRST_PROFILE_SLOT, defaultAspectFor, parseFirstOnboarding, parseFirstProfile, serializeFirstOnboarding, serializeFirstProfile, type FirstAnswers, type FirstOnboarding, type FirstProfile, type StoredDestination, type StoredRole } from './firstProfile';
import { readFirstGoal, writeFirstGoal } from './firstGoalStore';
import { fetchRemoteFirstAnswers, pushFirstOnboarding } from './firstProfileSync';
import type { StoredFirstGoal } from './firstGoal';

// Same two places as the first goal (firstGoalStore): the keychain survives a sign-out, the cache is the fallback.
// A failure to read only means the questions may be asked once more; a failure to save only means the same.
export async function readFirstProfile(): Promise<FirstProfile> {
    const fromKeychain = parseFirstProfile(await SecureStore.getItemAsync(FIRST_PROFILE_SLOT).catch(() => null));
    if (fromKeychain.role || fromKeychain.destination) return fromKeychain;
    return parseFirstProfile(await appStorage.get(FIRST_PROFILE_SLOT).catch(() => null));
}

// A real word on this phone is never replaced by "skipped" (the server keeps the same rule).
const keep = <T extends string>(old: T | null, next: T | null | undefined): T | null => (next == null ? old : next === 'skipped' && old ? old : next);

export async function writeFirstProfile(answers: { readonly role?: StoredRole | null; readonly destination?: StoredDestination | null }): Promise<FirstProfile> {
    const now = await readFirstProfile();
    const merged: FirstProfile = { role: keep(now.role, answers.role), destination: keep(now.destination, answers.destination) };
    if (merged.role || merged.destination) {
        const raw = serializeFirstProfile(merged);
        await Promise.all([SecureStore.setItemAsync(FIRST_PROFILE_SLOT, raw).catch(() => undefined), appStorage.set(FIRST_PROFILE_SLOT, raw).catch(() => undefined)]);
    }
    return merged;
}

export async function readFirstOnboarding(owner: string): Promise<FirstOnboarding | null> {
    const secure = parseFirstOnboarding(await SecureStore.getItemAsync(FIRST_ONBOARDING_SLOT).catch(() => null), owner);
    if (secure) return secure;
    return parseFirstOnboarding(await appStorage.get(FIRST_ONBOARDING_SLOT).catch(() => null), owner);
}

let onboardingWrites: Promise<void> = Promise.resolve();
export function writeFirstOnboarding(owner: string, state: FirstOnboarding, task?: ClientTask): Promise<void> {
    const run = async () => {
        if (!owner || (task && !task.current())) return;
        const raw = serializeFirstOnboarding(owner, state);
        await SecureStore.setItemAsync(FIRST_ONBOARDING_SLOT, raw).catch(() => undefined);
        if (task && !task.current()) return;
        await appStorage.set(FIRST_ONBOARDING_SLOT, raw).catch(() => undefined);
    };
    onboardingWrites = onboardingWrites.then(run, run);
    return onboardingWrites;
}

let onboardingReplays: Promise<FirstOnboarding | null> = Promise.resolve(null);
const samePendingIntent = (left: FirstOnboarding | null, right: FirstOnboarding): boolean =>
    (['goal', 'destination', 'role', 'currentStep', 'completeRequested'] as const)
        .every(key => (left?.[key] ?? null) === (right[key] ?? null));

// The write queue closes the read/write race with a newer answer: an older network acknowledgement may settle only
// the exact pending envelope it replayed.
function writeReplayResult(owner: string, state: FirstOnboarding, expected: FirstOnboarding, task: ClientTask): Promise<FirstOnboarding | null> {
    let result: FirstOnboarding | null = null;
    const run = async () => {
        if (!task.current()) return;
        const current = await readFirstOnboarding(owner);
        if (!task.current()) return;
        if (current?.pending && !samePendingIntent(current, expected)) { result = current; return; }
        const raw = serializeFirstOnboarding(owner, state);
        await SecureStore.setItemAsync(FIRST_ONBOARDING_SLOT, raw).catch(() => undefined);
        if (!task.current()) return;
        await appStorage.set(FIRST_ONBOARDING_SLOT, raw).catch(() => undefined);
        if (task.current()) result = state;
    };
    onboardingWrites = onboardingWrites.then(run, run);
    return onboardingWrites.then(() => result);
}

export function replayFirstOnboarding(api: Pick<ApiClient, 'request'>, task: ClientTask, state: FirstOnboarding): Promise<FirstOnboarding | null> {
    const run = async (): Promise<FirstOnboarding | null> => {
        if (!task.user || !task.current() || !state.pending) return state;
        // A queued replay may have been superseded while it waited. Always send the newest durable envelope.
        const latest = await readFirstOnboarding(task.user);
        if (!task.current()) return null;
        const desired = latest?.pending ? latest : state;
        let failed = false;
        for (const step of ['goal', 'destination', 'role'] as const) {
            const answer = desired[step];
            if (typeof answer !== 'string') continue;
            if (!await pushFirstOnboarding(api, task, { currentStep: step, answer })) { failed = true; break; }
            if (!task.current()) return null;
        }
        if (!failed && desired.completeRequested && desired.goal !== 'skipped') {
            if (!await pushFirstOnboarding(api, task, { currentStep: 'recap', completed: true })) failed = true;
        }
        if (!task.current()) return null;
        const remote = await fetchRemoteFirstAnswers(api, task, task.user);
        if (!task.current()) return null;
        if (remote.kind === 'answers' && remote.version !== undefined && remote.completed === true) {
            const settled: FirstOnboarding = { goal: remote.goal, role: remote.role, destination: remote.destination,
                version: remote.version, currentStep: null, completed: true };
            return writeReplayResult(task.user, settled, desired, task);
        }
        if (!failed && !desired.completeRequested && remote.kind === 'answers' && remote.version !== undefined && remote.completed !== undefined) {
            const settled: FirstOnboarding = { goal: remote.goal, role: remote.role, destination: remote.destination,
                version: remote.version, currentStep: remote.currentStep ?? null, completed: remote.completed };
            return writeReplayResult(task.user, settled, desired, task);
        }
        const pending: FirstOnboarding = { ...desired, version: 1, completed: false, pending: true,
            currentStep: remote.kind === 'answers' && remote.currentStep ? remote.currentStep : desired.currentStep ?? 'goal' };
        return writeReplayResult(task.user, pending, desired, task);
    };
    const result = onboardingReplays.then(run, run);
    onboardingReplays = result;
    return result;
}

export async function loadFirstOnboarding(api: Pick<ApiClient, 'request'>, task: ClientTask): Promise<FirstOnboarding | null> {
    if (!task.user || !task.current()) return null;
    const local = await readFirstOnboarding(task.user);
    if (!task.current()) return null;
    const remote = await fetchRemoteFirstAnswers(api, task, task.user);
    if (!task.current()) return null;
    if (remote.kind === 'answers' && remote.version !== undefined && remote.completed !== undefined) {
        if (local?.pending && !remote.completed) {
            void replayFirstOnboarding(api, task, local);
            return local;
        }
        const state: FirstOnboarding = { goal: remote.goal, role: remote.role, destination: remote.destination,
            version: remote.version, currentStep: remote.currentStep ?? null, completed: remote.completed };
        await writeFirstOnboarding(task.user, state, task);
        if (!task.current()) return null;
        if (remote.goal) void writeFirstGoal(remote.goal as StoredFirstGoal);
        await writeFirstProfile({ role: remote.role, destination: remote.destination });
        return task.current() ? state : null;
    }
    if (local?.pending) void replayFirstOnboarding(api, task, local);
    return local;
}

// Goal, role and destination as this person has them: the account's words when the server can be asked (including "none
// yet", so another account's copy on this phone never answers for this one), otherwise this phone's own copy.
export async function loadFirstAnswers(api: Pick<ApiClient, 'request'>): Promise<FirstAnswers> {
    const remote = await fetchRemoteFirstAnswers(api);
    if (remote.kind === 'answers') {
        if (remote.goal) void writeFirstGoal(remote.goal as StoredFirstGoal);
        await writeFirstProfile({ role: remote.role, destination: remote.destination });
        return { goal: remote.goal, role: remote.role, destination: remote.destination };
    }
    const [goal, profile] = await Promise.all([readFirstGoal(), readFirstProfile()]);
    return { goal, ...profile };
}

// Where the person said it will go, as the ratio Create opens in (9:16 for TikTok and Reels, 16:9 for YouTube), or null.
export const readDestinationAspect = (): Promise<string | null> => readFirstProfile().then((p) => defaultAspectFor(p.destination)).catch(() => null);
