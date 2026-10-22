// A short success buzz for a finished creation. The module is read the first time it is needed and a build without the
// native part (an older development build) just stays quiet: a missing buzz is never an error.
type Haptics = {
    notificationAsync: (type: unknown) => Promise<void>;
    selectionAsync: () => Promise<void>;
    NotificationFeedbackType: { Success: unknown; Error: unknown };
};

let loaded: Haptics | null | undefined;

function haptics(): Haptics | null {
    if (loaded !== undefined) return loaded;
    try {
        loaded = require('expo-haptics') as Haptics;
    } catch {
        loaded = null;
    }
    return loaded;
}

export async function playSuccess(): Promise<void> {
    try {
        const h = haptics();
        if (h) await h.notificationAsync(h.NotificationFeedbackType.Success);
    } catch {
        // No motor, or the setting is off: nothing to do.
    }
}

export async function playSelection(): Promise<void> {
    try {
        await haptics()?.selectionAsync();
    } catch {
        // Interaction feedback is a refinement, never a requirement.
    }
}

export async function playError(): Promise<void> {
    try {
        const h = haptics();
        if (h) await h.notificationAsync(h.NotificationFeedbackType.Error);
    } catch {
        // Validation still appears on screen when haptics are unavailable.
    }
}
