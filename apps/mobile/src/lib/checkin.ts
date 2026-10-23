import { ApiError, type ApiClient, type Balance } from './api';
import { appCache, getCacheUser } from './appCache';
import { POLICIES } from './cache';
import { publishBalance } from './balanceEvents';

export type CheckinStatus = {
    ok: true; claimed_today: boolean; streak: number; next_day: number;
    next_credits: number; rewards: number[];
};
export type CheckinClaim = {
    ok: true; already_claimed: boolean; streak: number; day: number; credits: number; balance_after: number;
};
export async function getCheckinStatus(api: ApiClient): Promise<CheckinStatus | null> {
    try { return await api.request<CheckinStatus>('/api/v1/checkin'); }
    catch (err) { if (err instanceof ApiError && err.status === 404) return null; throw err; }
}
export async function claimCheckin(api: ApiClient): Promise<CheckinClaim | null> {
    const owner = getCacheUser();
    let result: CheckinClaim;
    try { result = await api.request<CheckinClaim>('/api/v1/checkin', { method: 'POST' }); }
    catch (err) { if (err instanceof ApiError && err.status === 404) return null; throw err; }
    if (owner && owner === getCacheUser()) {
        // Refresh the spendable projection: ledger balance_after can include
        // expired Free/Subscription credits that the balance endpoint excludes.
        const fresh = await api.getBalance().catch(() => null);
        const previous = fresh ? null : await appCache.read<Balance>(POLICIES.balance, owner);
        const projection = fresh ?? (previous?.value ? { ...previous.value, balance: result.balance_after } : null);
        if (owner === getCacheUser()) {
            publishBalance(owner, projection?.balance ?? result.balance_after);
            if (projection) await appCache.write(POLICIES.balance, projection, owner);
        }
    }
    return result;
}
export const checkinErrorKey = (err: unknown): string =>
    err instanceof ApiError && err.code === 'checkin_busy' ? 'checkin.busy' : 'checkin.error';
