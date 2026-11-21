import type { SpeechOutcome } from './speechAnalysis';

/** Net credits after the outcome settles. Missing evidence stays unknown instead of guessing. */
export function smartCutNetCredits(outcome: Pick<SpeechOutcome, 'credits' | 'refunded'>): number | null {
    if (outcome.refunded === true) return 0;
    return typeof outcome.credits === 'number' && outcome.credits >= 0 ? outcome.credits : null;
}
