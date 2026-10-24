import { REVIEW_ASK_VERSION, claimReviewAsk, parseReviewAsk, resetReviewAskClaim, serializeReviewAsk, shouldAskForReview } from '../src/lib/reviewAsk';

describe('review ask', () => {
    beforeEach(() => resetReviewAskClaim());

    it('asks only for a creation the person waited for and can see, and only if never asked', () => {
        expect(shouldAskForReview(null, { waited: true, hasOutput: true })).toBe(true);
        expect(shouldAskForReview(null, { waited: false, hasOutput: true })).toBe(false);
        expect(shouldAskForReview(null, { waited: true, hasOutput: false })).toBe(false);
        expect(shouldAskForReview({ asked: true, at: '' }, { waited: true, hasOutput: true })).toBe(false);
    });

    it('round-trips the stored flag and rejects anything else', () => {
        const state = parseReviewAsk(serializeReviewAsk(new Date('2026-10-24T10:00:00Z')));
        expect(state).toEqual({ asked: true, at: '2026-10-24T10:00:00.000Z' });
        expect(parseReviewAsk(null)).toBeNull();
        expect(parseReviewAsk('not json')).toBeNull();
        expect(parseReviewAsk(JSON.stringify({ version: REVIEW_ASK_VERSION + 1, asked: true }))).toBeNull();
        expect(parseReviewAsk(JSON.stringify([]))).toBeNull();
    });

    it('lets one ask through per launch', () => {
        expect(claimReviewAsk()).toBe(true);
        expect(claimReviewAsk()).toBe(false);
    });
});
