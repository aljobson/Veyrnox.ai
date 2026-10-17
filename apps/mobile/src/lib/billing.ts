// Pure helpers for the purchase screens. No native modules here, so they are unit-tested.

// The part of a RevenueCat package the screens read.
export interface RcPackage {
    readonly identifier: string;
    readonly product: { readonly identifier: string; readonly title: string; readonly priceString: string };
}

export type Interval = 'week' | 'month' | 'year';

export interface DisplayPackage {
    readonly id: string;
    readonly productId: string;
    readonly title: string;
    readonly priceString: string;
    readonly credits: number | null;
    readonly interval: Interval | null;
}

const CREDITS_RE = /^ai\.veyrnox\.credits\.(\d{1,6})$/;
const PUBLISH_INTERVALS: Record<string, Interval> = {
    'ai.veyrnox.publish.weekly': 'week',
    'ai.veyrnox.publish.monthly': 'month',
    'ai.veyrnox.publish.annual': 'year',
};

export function creditsFor(productId: string): number | null {
    const m = CREDITS_RE.exec(productId);
    return m ? Number(m[1]) : null;
}

export function intervalFor(productId: string): Interval | null {
    return PUBLISH_INTERVALS[productId] ?? null;
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
