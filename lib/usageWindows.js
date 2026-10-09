// Net credit spend over rolling windows, from ledger rows. Only generation
// debits and their refunds count: grants, top-ups and expiry are not "usage".
// Debits are negative deltas, refunds positive, so spend is the negated sum.
const DAY_MS = 86_400_000;
export const USAGE_WINDOWS = { day: 1, week: 7, month: 30 };

const isUsage = (reason) => typeof reason === 'string' && (reason.startsWith('debit:') || reason.startsWith('refund:'));

/** @returns {{day: number, week: number, month: number}} credits spent, never below zero */
export function usageWindows(rows, now = Date.now()) {
    const out = { day: 0, week: 0, month: 0 };
    for (const row of rows) {
        if (!isUsage(row.reason) || !Number.isFinite(row.delta)) continue;
        const at = Date.parse(row.created_at);
        if (!Number.isFinite(at) || at > now) continue;
        for (const [name, days] of Object.entries(USAGE_WINDOWS)) {
            if (now - at < days * DAY_MS) out[name] -= row.delta;
        }
    }
    return { day: Math.max(0, out.day), week: Math.max(0, out.week), month: Math.max(0, out.month) };
}
