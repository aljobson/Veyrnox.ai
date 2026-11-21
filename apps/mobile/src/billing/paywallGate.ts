import type { PurchasesPackage } from 'react-native-purchases';
import { generationPlanFor, isRetiredGenerationProduct } from '../lib/billing';

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
    refreshSales(): Promise<boolean>;
    refreshGenerationAccess(): Promise<boolean>;
}

// The shared purchase store owns locking. This preflight only performs fresh server checks before
// RevenueCat is allowed to resume the native purchase.
export async function checkPaywallPurchase(pkg: PurchasesPackage, deps: PaywallGateDeps): Promise<PaywallGateResult> {
    if (isRetiredGenerationProduct(pkg.product.identifier)) return 'not_ready';
    if (!deps.canPurchase) return 'not_ready';
    try {
        if (!(await deps.refreshSales())) return 'sales_closed';
        if (generationPlanFor(pkg.product.identifier) !== null && (deps.generationActive || await deps.refreshGenerationAccess())) {
            return 'generation_already_active';
        }
        return 'ok';
    } catch {
        // An unresolved web plan or sales read fails closed.
        return 'not_ready';
    }
}
