import * as SecureStore from 'expo-secure-store';
import type { ApiClient } from './api';
import { CREATOR_PROFILE_ENABLED, VIBE_SLOT, fetchVibe, parseVibe, serializeVibe, shouldOfferVibe, type StoredVibe } from './creatorProfile';

// The phone's copy of the Vibe Check choice. A read that fails reads as "never chose"; a write that fails only means the
// interview may be offered once more.
export async function loadVibe(): Promise<StoredVibe | null> {
    try {
        return parseVibe(await SecureStore.getItemAsync(VIBE_SLOT));
    } catch {
        return null;
    }
}

export async function storeVibe(v: Omit<StoredVibe, 'version'>): Promise<void> {
    try {
        await SecureStore.setItemAsync(VIBE_SLOT, serializeVibe(v));
    } catch {
        // Not saved: the interview can be offered again.
    }
}

export async function clearVibe(): Promise<void> {
    try {
        await SecureStore.deleteItemAsync(VIBE_SLOT);
    } catch {
        // Nothing to remove.
    }
}

// True when this person should be shown the interview now: the build ships it and neither this phone nor the server has a
// choice on record. A choice found on the server (another phone, a reinstall) is kept here, so it is not asked twice.
export async function vibeOffered(api: Pick<ApiClient, 'request'>): Promise<boolean> {
    if (!CREATOR_PROFILE_ENABLED) return false;
    const local = await loadVibe();
    if (!shouldOfferVibe(local)) return false;
    const remote = await fetchVibe(api);
    if (!remote) return true;
    await storeVibe(remote);
    return false;
}
