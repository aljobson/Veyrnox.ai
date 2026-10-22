// First run (N3): a short welcome shown once, then never again on this phone. The only thing stored is a versioned
// "seen" flag; nothing about the person. A new version number would show the welcome again.
export const FIRST_RUN_SLOT = 'veyrnox.welcome.seen.v1';

export const WELCOME_CARDS = ['hello', 'credits', 'start'] as const;
export type WelcomeCard = (typeof WELCOME_CARDS)[number];

export function hasSeenWelcome(raw: string | null | undefined): boolean {
    if (!raw) return false;
    try {
        const value = JSON.parse(raw) as { version?: unknown; seen?: unknown } | null;
        return !!value && !Array.isArray(value) && value.version === 1 && value.seen === true;
    } catch {
        return false;
    }
}

export const serializeSeen = (): string => JSON.stringify({ version: 1, seen: true });

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
export function creditsCardKeys(free: number | null | undefined): { title: string; body: string; count: number | null } {
    const title = 'welcome.credits.title';
    if (typeof free === 'number' && Number.isFinite(free) && free > 0) return { title, body: 'welcome.credits.free', count: Math.floor(free) };
    return { title, body: 'welcome.credits.generic', count: null };
}
