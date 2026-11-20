import en from '../src/lib/i18n/messages/en';

// ADR-0071: the friend gets no referral bonus. The screen says so, and still gives the reward terms.
describe('Refer a friend copy', () => {
    const messages: Record<string, string> = en;
    it('states that a friend gets no extra bonus', () => {
        expect(messages['referrals.afriendwhousesyourcodegetsno']).toBe('A friend who uses your code gets no extra bonus from the referral.');
    });
    it('does not promise the friend welcome credits', () => {
        expect(messages['referrals.afriendwhousesyourcodegetsno']).not.toMatch(/welcome|free|credits?\b/i);
    });
    it('keeps the reward terms unchanged', () => {
        expect(messages['referrals.whenafriendyoureferbuystheir']).toContain('10% of that Pack');
        expect(messages['referrals.whenafriendyoureferbuystheir']).toContain('14 days later');
    });
});
