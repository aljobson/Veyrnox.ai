// What a new account is promised before it signs in. The grant itself is minted by the server (signup_grant, migration
// 0127, ADR-0013): 10 Free Credits once the email is confirmed, expiring 90 days after the grant. The welcome screen
// quotes the real balance after sign-in; this is only the pre-sign-in promise, so change it with the server, never alone.
// If ADR-0313's switch (starter credits on the first subscription) is turned on, the copy under signIn.offer.* must change too.
export const SIGNUP_FREE_CREDITS = 10;

export interface SignupOfferCopy { readonly title: 'signIn.offer.title'; readonly count: number; readonly body: string; readonly params?: { count: number } }

// Under the hard paywall the first credits arrive with a plan, so the offer says what the welcome card and the paywall say
// (credits.hardPaywall.bodyFree, with the paywall's fixed amount) instead of the confirm-email promise.
export function signupOfferCopy(hardStarter: number | null): SignupOfferCopy {
    if (hardStarter !== null) return { title: 'signIn.offer.title', count: hardStarter, body: 'credits.hardPaywall.bodyFree', params: { count: hardStarter } };
    return { title: 'signIn.offer.title', count: SIGNUP_FREE_CREDITS, body: 'signIn.offer.body' };
}
