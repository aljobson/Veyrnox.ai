import { english } from './i18n/binding';
// Pure helpers for the purchase screens. No native modules here, so they are unit-tested.

// The part of a RevenueCat package the screens read.
export interface RcPackage {
    readonly identifier: string;
    readonly product: {
        readonly identifier: string;
        readonly title: string;
        readonly priceString: string;
        readonly price?: number | null;
        readonly currencyCode?: string;
        readonly pricePerMonthString?: string | null;
        readonly discounts?: readonly RcDiscount[] | null;
        readonly introPrice?: RcIntroPrice | null;
    };
}

// The store's introductory offer on a product (RevenueCat introPrice). A price of 0 is a free trial.
export interface RcIntroPrice {
    readonly price: number;
    readonly periodUnit: string;
    readonly periodNumberOfUnits: number;
}

// Only fixed-length periods: a store MONTH or YEAR is a calendar period, so it is never turned into a number of days.
const UNIT_DAYS: Readonly<Record<string, number>> = { DAY: 1, WEEK: 7 };

/** Whole days of free trial the store gives on this product, or null when it has none (a paid intro offer or a calendar-month/year trial is not advertised as days). */
export function freeTrialDays(product: RcPackage['product']): number | null {
    const intro = product.introPrice;
    const unit = intro ? UNIT_DAYS[intro.periodUnit] : undefined;
    if (!intro || intro.price !== 0 || !unit || !Number.isSafeInteger(intro.periodNumberOfUnits) || intro.periodNumberOfUnits <= 0) return null;
    return unit * intro.periodNumberOfUnits;
}

export interface RcDiscount {
    readonly identifier: string;
    readonly price: number;
    readonly priceString: string;
    readonly cycles: number;
}

export type Interval = 'week' | 'month' | 'year';

export interface DisplayPackage {
    readonly id: string;
    readonly productId: string;
    readonly title: string;
    readonly priceString: string;
    readonly price?: number | null;
    readonly currencyCode?: string;
    readonly pricePerMonthString?: string | null;
    readonly credits: number | null;
    readonly interval: Interval | null;
    readonly generationPlan: GenerationPlan | null;
    /** Days of free trial the store gives on this plan; null or absent when none. */
    readonly trialDays?: number | null;
}

export type GenerationPlan = 'lite' | 'starter' | 'plus' | 'ultra';

export const WEB_PARITY_PACK_CREDITS = [209, 523, 1571] as const;

export interface GenerationCatalogPlan {
    readonly id: string;
    readonly credits: number;
}

const CREDITS_RE = /^ai\.veyrnox\.credits\.(\d{1,6})$/;
const PUBLISH_RE = /^ai\.veyrnox\.publish\.(weekly|monthly|annual)(?::(weekly|monthly|annual))?$/;
const GENERATION_RE = /^ai\.veyrnox\.generation\.(lite|starter|plus|ultra)\.(monthly|annual)(?::(monthly|annual))?$/;

function generationParts(productId: string): RegExpExecArray | null {
    const match = GENERATION_RE.exec(productId);
    return match && (!match[3] || match[3] === match[2]) ? match : null;
}

function publishInterval(productId: string): Interval | null {
    const match = PUBLISH_RE.exec(productId);
    if (!match || (match[2] && match[2] !== match[1])) return null;
    return match[1] === 'weekly' ? 'week' : match[1] === 'monthly' ? 'month' : 'year';
}

export function creditsFor(productId: string): number | null {
    const m = CREDITS_RE.exec(productId);
    return m ? Number(m[1]) : null;
}

export function intervalFor(productId: string): Interval | null {
    const generation = generationParts(productId);
    return publishInterval(productId) ?? (generation?.[2] === 'monthly' ? 'month' : generation?.[2] === 'annual' ? 'year' : null);
}

export function generationPlanFor(productId: string): GenerationPlan | null {
    return generationParts(productId)?.[1] as GenerationPlan | undefined ?? null;
}

export function generationCatalogId(productId: string): string | null {
    const match = generationParts(productId);
    return match ? `${match[1]}-${match[2] === 'annual' ? 'yearly' : 'monthly'}` : null;
}

export function isWebParityPack(pkg: DisplayPackage): boolean {
    return pkg.credits !== null && (WEB_PARITY_PACK_CREDITS as readonly number[]).includes(pkg.credits);
}

export function parseGenerationCatalog(value: unknown): GenerationCatalogPlan[] {
    if (!value || typeof value !== 'object' || !Array.isArray((value as { plans?: unknown }).plans)) return [];
    return (value as { plans: unknown[] }).plans.flatMap((plan) => {
        if (!plan || typeof plan !== 'object') return [];
        const id = (plan as { id?: unknown }).id;
        const credits = (plan as { credits?: unknown }).credits;
        return typeof id === 'string' && Number.isInteger(credits) && (credits as number) > 0
            ? [{ id, credits: credits as number }]
            : [];
    });
}

export function isPaidSubscriptionProduct(productId: string): boolean {
    return publishInterval(productId) !== null || generationPlanFor(productId) !== null;
}

// App Store price points are localized and may not land on exactly 15%. Only advertise the
// retention offer when the configured price is within one percentage point of the promised saving.
export function stayDiscountFor(pkg: RcPackage, identifier = 'stay15'): RcDiscount | null {
    const full = pkg.product.price;
    if (!full || full <= 0) return null;
    const discount = pkg.product.discounts?.find((item) => item.identifier === identifier) ?? null;
    if (!discount || discount.price < 0) return null;
    const percent = (1 - discount.price / full) * 100;
    return percent >= 14.5 && percent <= 15.5 ? discount : null;
}

const INTERVAL_ORDER: Record<Interval, number> = { week: 0, month: 1, year: 2 };
const GENERATION_PLAN_ORDER: Record<GenerationPlan, number> = { lite: 0, starter: 1, plus: 2, ultra: 3 };

export function toDisplayPackages(packages: readonly RcPackage[]): DisplayPackage[] {
    return packages
        .map((p) => ({
            id: p.identifier,
            productId: p.product.identifier,
            title: p.product.title,
            priceString: p.product.priceString,
            price: p.product.price ?? null,
            currencyCode: p.product.currencyCode,
            pricePerMonthString: p.product.pricePerMonthString,
            credits: creditsFor(p.product.identifier),
            interval: intervalFor(p.product.identifier),
            generationPlan: generationPlanFor(p.product.identifier),
            trialDays: freeTrialDays(p.product),
        }))
        .filter((p) => p.credits !== null || p.interval !== null)
        .sort((a, b) => {
            if (a.credits !== null || b.credits !== null) return (a.credits ?? Number.MAX_SAFE_INTEGER) - (b.credits ?? Number.MAX_SAFE_INTEGER);
            if (a.generationPlan && b.generationPlan && a.generationPlan !== b.generationPlan) {
                return GENERATION_PLAN_ORDER[a.generationPlan] - GENERATION_PLAN_ORDER[b.generationPlan];
            }
            return INTERVAL_ORDER[a.interval ?? 'week'] - INTERVAL_ORDER[b.interval ?? 'week'];
        });
}

const INTERVAL_WORD: Record<Interval, Parameters<typeof english>[0]> = { week: 'billing.intervalWeek', month: 'billing.intervalMonth', year: 'billing.intervalYear' };

// What a store requires on a subscription screen: the price, the period, that it renews, and how to stop it.
export function renewalTerms(interval: Interval, priceString: string, store: 'ios' | 'android'): string {
    const where = store === 'ios' ? english('billing.yourAppleIDsettings') : english('billing.theGooglePlaysubscriptionspage');
    return english('billing.perRenewsautomaticallyeachuntilyoucancel', { value1: priceString, value2: english(INTERVAL_WORD[interval]), value3: english(INTERVAL_WORD[interval]), value4: where });
}

export interface BalanceWait {
    readonly sleep?: (ms: number) => Promise<void>;
    readonly intervalMs?: number;
    readonly timeoutMs?: number;
    readonly minimumIncrease?: number;
    /** Absolute wall-clock deadline, including slow or stalled network reads. */
    readonly deadlineMs?: number;
    /** End confirmation promptly when its operation or session is invalidated. */
    readonly signal?: AbortSignal;
}

// A purchase is credited by the server when the store's webhook arrives, a few seconds after the sheet closes.
// Polls the balance until it moves off `before` or the time is up.
export async function waitForBalanceChange(
    read: () => Promise<number>,
    before: number,
    { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), intervalMs = 2000, timeoutMs = 40_000, minimumIncrease = 1, deadlineMs, signal }: BalanceWait = {},
): Promise<{ changed: boolean; balance: number }> {
    let balance = before;
    if (signal?.aborted) return { changed: false, balance };
    if (deadlineMs !== undefined || signal) {
        const deadlineAt = deadlineMs ?? Date.now() + timeoutMs;
        const expired = Symbol('deadline');
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<typeof expired>(resolve => {
            timer = setTimeout(() => resolve(expired), Math.max(0, deadlineAt - Date.now()));
        });
        let stop!: () => void;
        const cancelled = new Promise<typeof expired>(resolve => { stop = () => resolve(expired); });
        signal?.addEventListener('abort', stop, { once: true });
        try {
            while (!signal?.aborted && Date.now() < deadlineAt) {
                try {
                    const next = await Promise.race([read(), deadline, cancelled]);
                    if (signal?.aborted || next === expired || Date.now() >= deadlineAt) break;
                    balance = next;
                    if (balance >= before + Math.max(1, minimumIncrease)) return { changed: true, balance };
                } catch { /* Retry only within the elapsed deadline and current session. */ }
                if (signal?.aborted) break;
                if (await Promise.race([sleep(Math.min(intervalMs, Math.max(0, deadlineAt - Date.now()))), deadline, cancelled]) === expired) break;
            }
            return { changed: false, balance };
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
    }
    for (let waited = 0; waited <= timeoutMs; waited += intervalMs) {
        try {
            balance = await read();
            if (balance >= before + Math.max(1, minimumIncrease)) return { changed: true, balance };
        } catch {
            // A failed read is retried until the time is up.
        }
        await sleep(intervalMs);
    }
    return { changed: false, balance };
}

// The public test-store key must never replace a release production platform key.
export function revenueCatKey(dev: boolean, environment: string, testKey?: string, platformKey?: string): string {
    return ((dev || environment === 'staging') && testKey) || platformKey || '';
}

/**
 * An App Store introductory offer is configured per product but granted per Apple ID, so on iOS a trial is shown only
 * when the store confirmed this account is eligible; unknown or ineligible means the paid flow. Google Play only returns
 * the offers the account can take, so its trial is trusted as is.
 */
export function gateTrialByEligibility<T extends { readonly productId: string; readonly trialDays?: number | null }>(
    plans: readonly T[], store: 'ios' | 'android', eligibleProductIds: ReadonlySet<string> | null,
): T[] {
    return plans.map(plan => (store === 'ios' && !eligibleProductIds?.has(plan.productId) ? { ...plan, trialDays: null } : plan));
}
