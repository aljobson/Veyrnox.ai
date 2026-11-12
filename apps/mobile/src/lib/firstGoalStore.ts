import * as SecureStore from 'expo-secure-store';
import { appStorage } from './appCache';
import { FIRST_GOAL_SLOT, parseFirstGoal, serializeFirstGoal, type StoredFirstGoal } from './firstGoal';

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
