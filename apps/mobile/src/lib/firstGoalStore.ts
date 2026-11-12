import * as SecureStore from 'expo-secure-store';
import { appStorage } from './appCache';
import type { ApiClient } from './api';
import { pushFirstGoal } from './firstGoalSync';
import { FIRST_GOAL_SLOT, homeStartGoal, parseFirstGoal, serializeFirstGoal, type StoredFirstGoal } from './firstGoal';

// Same two places as the welcome record (markWelcomeSeen): the keychain survives a sign-out, the cache is the fallback.
// A failure to read only means the question may be asked once more; a failure to save only means the same.
export async function readFirstGoal(): Promise<StoredFirstGoal | null> {
    const fromKeychain = parseFirstGoal(await SecureStore.getItemAsync(FIRST_GOAL_SLOT).catch(() => null));
    if (fromKeychain) return fromKeychain;
    return parseFirstGoal(await appStorage.get(FIRST_GOAL_SLOT).catch(() => null));
}

export async function writeFirstGoal(goal: StoredFirstGoal): Promise<void> {
    const raw = serializeFirstGoal(goal);
    await Promise.all([SecureStore.setItemAsync(FIRST_GOAL_SLOT, raw).catch(() => undefined), appStorage.set(FIRST_GOAL_SLOT, raw).catch(() => undefined)]);
}

let startedAtHome = false;
// True once a home start option was tapped in this launch, so Create does not ask while the server copy is still on its way.
export const homeStartRecorded = (): boolean => startedAtHome;

// A home start option is the first-goal answer. Stored once: an answer already held on this phone stays.
export async function recordHomeStart(api: Pick<ApiClient, 'request'>, key: string): Promise<void> {
    const goal = homeStartGoal(key);
    if (!goal) return;
    startedAtHome = true;
    if (await readFirstGoal()) return;
    await writeFirstGoal(goal);
    await pushFirstGoal(api, goal);
}
