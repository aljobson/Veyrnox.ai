// The low-balance prompt (N6). "Low" means the person cannot afford even the cheapest template, so the prompt is
// about being stuck, not about a number. Without a price list, a small fixed amount stands in. The server decides every
// price; this only decides whether to offer Buy credits.
export const LOW_BALANCE_FALLBACK = 3;

export function cheapestCredits(items: ReadonlyArray<{ readonly credits: number }> | null | undefined): number | null {
    if (!items) return null;
    let best: number | null = null;
    for (const item of items) {
        const n = item.credits;
        if (Number.isInteger(n) && n > 0 && (best === null || n < best)) best = n;
    }
    return best;
}

export function isLowBalance(balance: number | null | undefined, cheapest: number | null): boolean {
    if (typeof balance !== 'number' || !Number.isFinite(balance)) return false;
    return balance < (cheapest ?? LOW_BALANCE_FALLBACK);
}
