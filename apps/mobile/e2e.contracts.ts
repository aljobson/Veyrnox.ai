/**
 * Pure E2E contracts shared by the device suites and Jest drift tests.
 * Keep this module free of runner imports so Jest can validate it cheaply.
 */

export const STATIC_ROUTE_CRAWL_EXCLUSIONS: Readonly<Record<string, string>> = {
    '+native-intent': 'Expo Router system hook, not a user-visible screen.',
    '+not-found': 'Expo Router fallback, exercised only by unmatched-route tests.',
    'dev-b1-beat': 'Development-only beat engine harness, not a production route.',
    'dev-n0-beat': 'Development-only beat engine harness, not a production route.',
    'email-code': 'Passwordless email authentication is covered outside the signed-in route sweep.',
    film: 'Retired Film Studio entry point is intentionally absent from production navigation.',
    'film/cloud': 'Retired Film Studio route is intentionally absent from production navigation.',
    'film/workspace': 'Retired Film Studio route is intentionally absent from production navigation.',
    'first-run': 'Covered by the dedicated fresh-install onboarding E2E path.',
    'notification-primer': 'Contextual one-shot explanation after a long generation; generic crawling could open the system permission prompt.',
    onboarding: 'Signed-out value-first onboarding is outside the authenticated route sweep.',
    'sign-in': 'Authentication is covered by the sign-in helper and is outside the signed-in route sweep.',
    welcome: 'Legacy onboarding entry is outside the signed-in route sweep.',
};

/**
 * These screens remain in the read-only sweep, but a generic control tap can
 * charge money or destroy account data even when button copy changes.
 */
export const INTERACTION_CRAWL_ROUTE_EXCLUSIONS: Readonly<Record<string, string>> = {
    'beats/new': 'Opening this route creates a seed Beat project before any control is tapped.',
    create: 'Generation controls can spend credits and require a purpose-built test.',
    'create/agent': 'Agent generation controls can spend credits and require a purpose-built test.',
    'create/catalog-template': 'Template generation controls can spend credits and require a purpose-built test.',
    credits: 'Credit purchase controls can initiate a transaction.',
    'delete-account': 'Account deletion must only be exercised by a purpose-built destructive test.',
    dialogue: 'Dialogue generation controls can spend credits and require a purpose-built test.',
    'faceless-reel': 'Reel generation controls can spend credits and require a purpose-built test.',
    'music/create': 'Music generation controls can spend credits and require a purpose-built test.',
    'music/render': 'Music rendering controls can spend credits and require a purpose-built test.',
    paywall: 'Subscription controls can initiate a transaction.',
    pricing: 'Plan selection controls can initiate a transaction.',
    speech: 'Speech generation controls can spend credits and require a purpose-built test.',
    topups: 'Credit top-up controls can initiate a transaction.',
};

/** Network-backed representatives selected from the canonical crawl inventory. */
export const ERROR_STATE_ROUTE_TAGS: Readonly<Record<string, string>> = {
    '': 'Signed-in home shell and dashboard feeds.',
    account: 'Account profile and subscription reads.',
    chat: 'Conversation list and assistant availability.',
    create: 'Model catalogue and generation configuration.',
    credits: 'Credit balance and entitlement reads.',
    help: 'Support content and contact state.',
    history: 'Generation history requests.',
    library: 'Media library requests.',
    models: 'Model catalogue requests.',
    pricing: 'Plan catalogue and entitlement reads.',
    publish: 'Publishing workspace requests.',
};

export function selectInventoryRoutes(
    inventory: readonly string[],
    taggedRoutes: Readonly<Record<string, string>>,
): string[] {
    const selected = new Set(Object.keys(taggedRoutes));
    return inventory.filter((route) => selected.has(route));
}

/** Accessible English names asserted by the signed-in drawer smoke test. */
export const NAVIGATION_MENU_LABELS = [
    'Create',
    'Creative tools',
    'Audio',
    'Smart Cut',
    'Editor',
    'Publish',
    'Social Cinema',
    'Library',
    'Brand kit',
    'Credits',
    'LLM Chat',
    'Help',
] as const;

export const LANDSCAPE_ORIENTATIONS = ['landscape-left', 'landscape-right'] as const;
