// Which accounts have already passed the two-factor check in this launch. The check asks the server who the person is,
// so a screen that remounts must not ask again: it reads this instead. Held in memory only, so every launch asks once.
const cleared = new Set<string>();

export const mfaClearedFor = (userId: string | null): boolean => !!userId && cleared.has(userId);

export function markMfaCleared(userId: string | null): void {
    if (userId) cleared.add(userId);
}

// Sign-out: the next person to sign in is asked afresh.
export function forgetMfaCleared(): void {
    cleared.clear();
}
