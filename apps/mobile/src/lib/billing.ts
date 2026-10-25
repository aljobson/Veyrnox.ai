// Pure helpers for the purchase screens. No native modules here, so they are unit-tested.

// The part of a RevenueCat package the screens read.
export interface RcPackage {
    readonly identifier: string;
    readonly product: {
        readonly identifier: string;
        readonly title: string;
        readonly priceString: string;
        readonly price?: number;
        readonly discounts?: readonly RcDiscount[] | null;
    };
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
    readonly credits: number | null;
    readonly interval: Interval | null;
    readonly generationPlan: GenerationPlan | null;
}

export type GenerationPlan = 'lite' | 'starter' | 'plus' | 'ultra';

const CREDITS_RE = /^ai\.veyrnox\.credits\.(\d{1,6})$/;
const PUBLISH_INTERVALS: Record<string, Interval> = {
    'ai.veyrnox.publish.weekly': 'week',
    'ai.veyrnox.publish.monthly': 'month',
    'ai.veyrnox.publish.annual': 'year',
};
const GENERATION_RE = /^ai\.veyrnox\.generation\.(lite|starter|plus|ultra)\.(monthly|annual)$/;

export function creditsFor(productId: string): number | null {
    const m = CREDITS_RE.exec(productId);
    return m ? Number(m[1]) : null;
}

export function intervalFor(productId: string): Interval | null {
    const generation = GENERATION_RE.exec(productId);
    return PUBLISH_INTERVALS[productId] ?? (generation?.[2] === 'monthly' ? 'month' : generation?.[2] === 'annual' ? 'year' : null);
}

export function generationPlanFor(productId: string): GenerationPlan | null {
    return GENERATION_RE.exec(productId)?.[1] as GenerationPlan | undefined ?? null;
}

export function isPaidSubscriptionProduct(productId: string): boolean {
    return productId.startsWith('ai.veyrnox.publish.') || generationPlanFor(productId) !== null;
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

export function toDisplayPackages(packages: readonly RcPackage[]): DisplayPackage[] {
    return packages
        .map((p) => ({
            id: p.identifier,
            productId: p.product.identifier,
            title: p.product.title,
            priceString: p.product.priceString,
            credits: creditsFor(p.product.identifier),
            interval: intervalFor(p.product.identifier),
            generationPlan: generationPlanFor(p.product.identifier),
        }))
        .filter((p) => p.credits !== null || p.interval !== null)
        .sort((a, b) => (a.credits ?? 0) - (b.credits ?? 0) || INTERVAL_ORDER[a.interval ?? 'week'] - INTERVAL_ORDER[b.interval ?? 'week']);
}

const INTERVAL_WORD: Record<Interval, string> = { week: 'week', month: 'month', year: 'year' };

// What a store requires on a subscription screen: the price, the period, that it renews, and how to stop it.
export function renewalTerms(interval: Interval, priceString: string, store: 'ios' | 'android'): string {
    const where = store === 'ios' ? 'your Apple ID settings' : 'the Google Play subscriptions page';
    return `${priceString} per ${INTERVAL_WORD[interval]}. Renews automatically each ${INTERVAL_WORD[interval]} until you cancel in ${where}. Cancel at least a day before renewal to avoid the next charge.`;
}

export interface BalanceWait {
    readonly sleep?: (ms: number) => Promise<void>;
    readonly intervalMs?: number;
    readonly timeoutMs?: number;
}

// A purchase is credited by the server when the store's webhook arrives, a few seconds after the sheet closes.
// Polls the balance until it moves off `before` or the time is up.
export async function waitForBalanceChange(
    read: () => Promise<number>,
    before: number,
    { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), intervalMs = 2000, timeoutMs = 40_000 }: BalanceWait = {},
): Promise<{ changed: boolean; balance: number }> {
    let balance = before;
    for (let waited = 0; waited <= timeoutMs; waited += intervalMs) {
        try {
            balance = await read();
            if (balance !== before) return { changed: true, balance };
        } catch {
            // A failed read is retried until the time is up.
        }
        await sleep(intervalMs);
    }
    return { changed: false, balance };
}
