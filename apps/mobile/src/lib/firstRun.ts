// First run (N3): a short welcome shown once, then never again on this phone. The only thing stored is a versioned
// "seen" flag; nothing about the person. Version 2 introduces the Mobbin-inspired, input-first journey, so it must
// not inherit the completed flag from the older generic welcome.
export const FIRST_RUN_VERSION = 2;
export const FIRST_RUN_SLOT = `veyrnox.welcome.seen.v${FIRST_RUN_VERSION}`;

// The intro is one hello now, shown by Vey above the first question (first-run); the old credits and start cards are gone.
export const WELCOME_CARDS = ['hello'] as const;
export type WelcomeCard = (typeof WELCOME_CARDS)[number];
// One progress bar runs across the whole journey: the three questions and the recap that closes it.
export const FIRST_RUN_QUESTIONS = 3;
export const ONBOARDING_TOTAL = FIRST_RUN_QUESTIONS + 1;

// Any goal that was answered ends on the recap, so the person sees a sample result before the paywall (a creation goal
// shows its own kind, "not sure" and the edit/publish goals show a general one). Only a skipped or missing goal finishes
// after the last question, so the bar counts one fewer screen. Before a goal is known (first screen, nothing picked) it assumes the long way.
export const hasRecap = (goal: string | undefined): boolean => !!goal && goal !== 'skipped';

export function journeyTotalFor(goal: string | undefined, step: number): number {
    if (step === 0 && !goal) return ONBOARDING_TOTAL;
    return hasRecap(goal) ? ONBOARDING_TOTAL : ONBOARDING_TOTAL - 1;
}

// Goal gradient: the bar starts part-filled (step 1 is already a fraction of the way), and near the end it names what is
// left ("Two to go") rather than what is done. Earlier, and on the last screen, the plain "Step n of total" stands.
export function stepsLeftKey(step: number, total: number): 'welcome.toGo.one' | 'welcome.toGo.two' | null {
    const left = total - step;
    return left === 1 ? 'welcome.toGo.one' : left === 2 ? 'welcome.toGo.two' : null;
}

export function hasSeenWelcome(raw: string | null | undefined): boolean {
    if (!raw) return false;
    try {
        const value = JSON.parse(raw) as { version?: unknown; seen?: unknown } | null;
        return !!value && !Array.isArray(value) && value.version === FIRST_RUN_VERSION && value.seen === true;
    } catch {
        return false;
    }
}

export const serializeSeen = (): string => JSON.stringify({ version: FIRST_RUN_VERSION, seen: true });

// The redirect to the welcome is sent at most once per launch, however many times its gate mounts: a screen that
// remounts in a loop must not send the person there again and again.
let welcomeRedirectSent = false;

export function claimWelcomeRedirect(): boolean {
    if (welcomeRedirectSent) return false;
    welcomeRedirectSent = true;
    return true;
}

// For tests.
export function resetWelcomeRedirect(): void {
    welcomeRedirectSent = false;
}

// The credits card quotes the free credits the server says this account holds (GET /api/v1/balance, free_credits). When
// there are none, or the number is unreadable, it explains credits without a number rather than promising one.
export interface CreditsCard { title: string; body: string; count: number | null; params?: { count: number } }

// Under the hard paywall (hardStarter = the fixed starter amount) the first credits arrive when the person subscribes, so
// the card says what the paywall says, with the paywall's own words and its fixed amount, never the account balance.
export function creditsCardKeys(free: number | null | undefined, hardStarter: number | null = null): CreditsCard {
    const title = 'welcome.credits.title';
    if (hardStarter !== null) return { title, body: 'credits.hardPaywall.bodyFree', count: null, params: { count: hardStarter } };
    if (typeof free === 'number' && Number.isFinite(free) && free > 0) return { title, body: 'welcome.credits.free', count: Math.floor(free) };
    return { title, body: 'welcome.credits.generic', count: null };
}
