import * as SecureStore from 'expo-secure-store';
import { appStorage } from './appCache';
import type { ApiClient } from './api';
import { FIRST_PROFILE_SLOT, defaultAspectFor, parseFirstProfile, serializeFirstProfile, type FirstAnswers, type FirstProfile, type StoredDestination, type StoredRole } from './firstProfile';
import { readFirstGoal, writeFirstGoal } from './firstGoalStore';
import { fetchRemoteFirstAnswers } from './firstProfileSync';
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
