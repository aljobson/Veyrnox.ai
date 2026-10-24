import * as SecureStore from 'expo-secure-store';
import { REVIEW_ASK_SLOT, parseReviewAsk, serializeReviewAsk, type ReviewAskState } from './reviewAsk';

// The store's own rating sheet. The module is read the first time it is needed and a build without the native part
// (an older development build) just does nothing: a missing sheet is never an error.
type StoreReview = { isAvailableAsync: () => Promise<boolean>; requestReview: () => Promise<void> };

let loaded: StoreReview | null | undefined;

function storeReview(): StoreReview | null {
    if (loaded !== undefined) return loaded;
    try {
        loaded = require('expo-store-review') as StoreReview;
    } catch {
        loaded = null;
    }
    return loaded;
}

export async function loadReviewAsk(): Promise<ReviewAskState> {
    try {
        return parseReviewAsk(await SecureStore.getItemAsync(REVIEW_ASK_SLOT));
    } catch {
        // Unreadable: treat as asked, so a broken store can never turn into repeated asks.
        return { asked: true, at: '' };
    }
}

// Records the ask. A failure to save only means it may be made once more.
export async function markReviewAsked(): Promise<void> {
    try {
        await SecureStore.setItemAsync(REVIEW_ASK_SLOT, serializeReviewAsk(new Date()));
    } catch {
        // Not saved.
    }
}

export async function openRatingSheet(): Promise<void> {
    try {
        const sheet = storeReview();
        if (sheet && (await sheet.isAvailableAsync())) await sheet.requestReview();
    } catch {
        // The system decides whether the sheet shows; nothing to report.
    }
}
