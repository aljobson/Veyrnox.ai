import * as SecureStore from 'expo-secure-store';
import { appStorage } from './appCache';
import { FIRST_RUN_SLOT, serializeSeen } from './firstRun';
// Records that the welcome was shown (or skipped). A failure to save only means it may show once more.
export async function markWelcomeSeen(): Promise<void> {
    const seen = serializeSeen();
    await Promise.all([SecureStore.setItemAsync(FIRST_RUN_SLOT, seen).catch(() => undefined), appStorage.set(FIRST_RUN_SLOT, seen).catch(() => undefined)]);
}

