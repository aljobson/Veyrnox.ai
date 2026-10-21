// A short success buzz for a finished creation. The module is read the first time it is needed and a build without the
// native part (an older development build) just stays quiet: a missing buzz is never an error.
type Haptics = {
    notificationAsync: (type: unknown) => Promise<void>;
    NotificationFeedbackType: { Success: unknown };
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
