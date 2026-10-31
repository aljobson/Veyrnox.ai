import type { PurchasesPackage } from 'react-native-purchases';
import { generationPlanFor } from '../lib/billing';

// RevenueCat paywalls (ADR-0108 amendment 4) run their own purchase, so the app's checks run first in
// onPurchasePackageInitiated and the purchase goes ahead only on 'ok'. Same rules as BillingProvider.purchase.
export const PAYWALL_OFFERINGS = ['generation', 'credits', 'publish'] as const;
export type PaywallOffering = (typeof PAYWALL_OFFERINGS)[number];
export type PaywallGateResult = 'ok' | 'not_ready' | 'busy' | 'sales_closed' | 'generation_already_active';

export const paywallsEnabled = (value: string | undefined = process.env.EXPO_PUBLIC_RC_PAYWALLS_ENABLED): boolean => value === 'true';

export function parsePaywallOffering(value: unknown): PaywallOffering | null {
    return typeof value === 'string' && (PAYWALL_OFFERINGS as readonly string[]).includes(value) ? value as PaywallOffering : null;
}

export interface PaywallGateDeps {
    readonly canPurchase: boolean;
    readonly generationActive: boolean;
    acquireLock(): (() => void) | null;
    refreshSales(): Promise<boolean>;
    refreshGenerationAccess(): Promise<boolean>;
}

// On 'ok' the returned release must be called when the purchase ends, whatever the outcome.
export async function checkPaywallPurchase(pkg: PurchasesPackage, deps: PaywallGateDeps): Promise<{ result: PaywallGateResult; release: () => void }> {
    const none = () => undefined;
    if (!deps.canPurchase) return { result: 'not_ready', release: none };
    const release = deps.acquireLock();
    if (!release) return { result: 'busy', release: none };
    try {
        if (!(await deps.refreshSales())) { release(); return { result: 'sales_closed', release: none }; }
        if (generationPlanFor(pkg.product.identifier) !== null && (deps.generationActive || await deps.refreshGenerationAccess())) {
            release();
            return { result: 'generation_already_active', release: none };
        }
        return { result: 'ok', release };
    } catch {
        // An unresolved web plan or sales read fails closed.
        release();
        return { result: 'not_ready', release: none };
    }
}
