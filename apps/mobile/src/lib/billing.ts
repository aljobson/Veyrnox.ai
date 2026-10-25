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

export const WEB_PARITY_PACK_CREDITS = [100, 300, 1000] as const;

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
            credits: creditsFor(p.product.identifier),
            interval: intervalFor(p.product.identifier),
            generationPlan: generationPlanFor(p.product.identifier),
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
    readonly minimumIncrease?: number;
}

// A purchase is credited by the server when the store's webhook arrives, a few seconds after the sheet closes.
// Polls the balance until it moves off `before` or the time is up.
export async function waitForBalanceChange(
    read: () => Promise<number>,
    before: number,
    { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), intervalMs = 2000, timeoutMs = 40_000, minimumIncrease = 1 }: BalanceWait = {},
): Promise<{ changed: boolean; balance: number }> {
    let balance = before;
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
