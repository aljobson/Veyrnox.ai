import type { DisplayPackage } from './billing';
import { kindOf, type CatalogModel } from './media';

function comparable(items: readonly DisplayPackage[]) {
    const currency = items[0]?.currencyCode;
    return !!currency && items.every(p => p.currencyCode === currency && typeof p.price === 'number' && Number.isFinite(p.price) && p.price > 0);
}
export function packRates(packs: readonly DisplayPackage[]): Map<string, number> | null {
    if (!comparable(packs) || packs.some(p => !p.credits || p.credits <= 0)) return null;
    return new Map(packs.map(p => [p.id, p.price! / p.credits!]));
}
export function bestPackId(packs: readonly DisplayPackage[]): string | null {
    const rates = packRates(packs);
    if (!rates || packs.length < 2) return null;
    const sorted = [...rates].sort((a, b) => a[1] - b[1]);
    return sorted[0][1] < sorted[1][1] ? sorted[0][0] : null;
}
export function packSavingPercent(pack: DisplayPackage, packs: readonly DisplayPackage[]): number | null {
    const rates = packRates(packs);
    const rate = rates?.get(pack.id);
    return rates && rate ? Math.floor((1 - rate / Math.max(...rates.values())) * 100) : null;
}
export function subscriptionSavingPercent(plan: DisplayPackage, credits: number | undefined, packs: readonly DisplayPackage[]): number | null {
    const rates = packRates(packs);
    if (!rates?.size || !credits || !comparable([plan, ...packs])) return null;
    const allowance = credits * (plan.interval === 'year' ? 12 : 1);
    return Math.floor((1 - plan.price! / allowance / Math.min(...rates.values())) * 100);
}
export function yearlySaving(plan: DisplayPackage, plans: readonly DisplayPackage[]): number | null {
    const monthly = plans.find(p => p.generationPlan === plan.generationPlan && p.interval === 'month');
    if (plan.interval !== 'year' || !monthly || !comparable([plan, monthly])) return null;
    return Math.floor((1 - plan.price! / (monthly.price! * 12)) * 100);
}
export function typicalCosts(models: readonly CatalogModel[]) {
    const median = (kind: 'image' | 'video') => {
        const values = models.filter(m => kindOf(m.modality) === kind && !m.gated && !m.capabilities?.inputs?.plan_id && Number.isFinite(m.credits) && m.credits > 0).map(m => m.credits).sort((a, b) => a - b);
        const middle = Math.floor(values.length / 2);
        return values.length ? values[middle] : null;
    };
    return { video: median('video'), image: median('image') };
}
export const planName = (value: string) => `${value[0].toUpperCase()}${value.slice(1)}`;
