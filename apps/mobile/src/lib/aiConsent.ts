import { ApiError } from './api';

// ADR-0128 (Apple 5.1.2(i), Google AI-content policy): before the app sends a person's content to a third-party AI
// provider for the first time, it asks, once per wording version and account. Declining sends nothing. The gate sits
// in the API client, so no screen can reach a provider without it. The server's own `consent: true` on uploaded
// sources (ADR-0094, aup-2026-09-26) is separate and unchanged.
// Thrown before a call leaves the phone when the person answered "Not now". Screens map it to one specific message.
export class ConsentDeclinedError extends ApiError {
    constructor() {
        super(400, 'consent_declined');
        this.name = 'ConsentDeclinedError';
    }
}

export const CONSENT_DECLINED_MESSAGE = 'You need to accept to use AI features. Nothing was sent and you were not charged.';

export const AI_CONSENT_VERSION = 'ai-share-2026-10-18';

export const AI_CONSENT_TEXT = {
    title: 'Before you create',
    body:
        'To make your creations and answer your chats, Veyrnox.ai sends what you type, and any photos, video or audio you add, to the third-party AI providers that run the models. ' +
        'They use it only to produce your result. Your content leaves our servers when you do this.',
    privacyLabel: 'Read the Privacy Policy',
    agree: 'Agree and continue',
    decline: 'Not now',
} as const;

// Calls that carry the person's own content toward a provider. Reads, balance and account calls do not.
const CONTENT_POSTS: readonly RegExp[] = [
    /^\/api\/v1\/generations(\?|$)/,
    /^\/api\/v1\/uploads(\/|\?|$)/,
    /^\/api\/v1\/montage\/plan(\?|$)/,
    /^\/api\/v1\/chat\/threads\/[^/?]+\/messages(\?|$)/,
];

export function sendsContent(path: string, method: string): boolean {
    return method.toUpperCase() === 'POST' && CONTENT_POSTS.some((re) => re.test(path));
}

export interface ConsentStorage {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
}

export interface ConsentGate {
    setUser(userId: string | null): void;
    setPrompter(ask: (() => Promise<boolean>) | null): void;
    // Resolves when the call may go on; throws ApiError(400, 'consent_declined') when the person says Not now.
    ensure(path: string, method: string): Promise<void>;
    // Whether this account has agreed under the current wording (false while signed out).
    hasAgreed(): Promise<boolean>;
    // Sign-out and account deletion: deletes this account's stored agreement and forgets the account.
    forget(): Promise<void>;
}

export function createConsentGate(storage: ConsentStorage): ConsentGate {
    let userId: string | null = null;
    let ask: (() => Promise<boolean>) | null = null;
    let pending: Promise<boolean> | null = null;

    const keyFor = (id: string) => `veyrnox.consent.${AI_CONSENT_VERSION}.${id}`;
    const agreed = async (id: string) => (await storage.get(keyFor(id)).catch(() => null)) === 'agreed';

    return {
        setUser: (id) => {
            userId = id;
        },
        setPrompter: (fn) => {
            ask = fn;
        },
        hasAgreed: async () => (userId ? agreed(userId) : false),
        async forget() {
            const id = userId;
            userId = null;
            if (id) await storage.remove(keyFor(id)).catch(() => undefined);
        },
        async ensure(path, method) {
            if (!sendsContent(path, method)) return;
            const id = userId;
            // No known account or no screen to ask on: refuse rather than send without asking.
            if (!id || !ask) throw new ConsentDeclinedError();
            if (await agreed(id)) return;
            // Two sends at once share one question, and the answer is stored before either goes on.
            pending ??= ask()
                .then(async (ok) => {
                    if (ok) await storage.set(keyFor(id), 'agreed').catch(() => undefined);
                    return ok;
                })
                .finally(() => {
                    pending = null;
                });
            if (!(await pending)) throw new ConsentDeclinedError();
        },
    };
}
