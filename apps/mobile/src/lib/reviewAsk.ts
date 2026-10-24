// The App Store rating ask: once per phone, after the first finished creation has been seen, never before. The
// answer is never read to decide anything: everyone who reaches the screen can open the store's own rating sheet,
// whatever they think of the app, and nothing is given or taken away for rating. The only thing stored is whether
// the ask was made and when.
export const REVIEW_ASK_VERSION = 1;
export const REVIEW_ASK_SLOT = `veyrnox.reviewAsk.v${REVIEW_ASK_VERSION}`;

// Wait this long after the finished creation appears, so the person sees the result first.
export const REVIEW_ASK_DELAY_MS = 2000;

export type ReviewAskState = { asked: true; at: string } | null;

export function parseReviewAsk(raw: string | null | undefined): ReviewAskState {
    if (!raw) return null;
    try {
        const value = JSON.parse(raw) as { version?: unknown; asked?: unknown; at?: unknown } | null;
        if (!value || Array.isArray(value) || value.version !== REVIEW_ASK_VERSION || value.asked !== true) return null;
        return { asked: true, at: typeof value.at === 'string' ? value.at : '' };
    } catch {
        return null;
    }
}

export const serializeReviewAsk = (now: Date): string => JSON.stringify({ version: REVIEW_ASK_VERSION, asked: true, at: now.toISOString() });

// Ask only for a creation the person waited for and now has in front of them, and only if they were never asked.
// A creation opened from the library does not count: the moment is the first result, not a revisit.
export function shouldAskForReview(state: ReviewAskState, creation: { waited: boolean; hasOutput: boolean }): boolean {
    return state === null && creation.waited && creation.hasOutput;
}

// One ask per launch even if the screen mounts twice before the answer is saved.
let claimed = false;

export function claimReviewAsk(): boolean {
    if (claimed) return false;
    claimed = true;
    return true;
}

// For tests.
export function resetReviewAskClaim(): void {
    claimed = false;
}
