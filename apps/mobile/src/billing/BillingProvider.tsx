import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import Purchases, { type CustomerInfo, type PurchasesOfferings, type PurchasesPackage } from 'react-native-purchases';
import { useAuth } from '../auth/AuthProvider';
import { ApiError } from '../lib/api';
import { generationPlanFor, stayDiscountFor } from '../lib/billing';
import { getCacheUser } from '../lib/appCache';

// Store billing is a build-time switch (ADR-0108); the server has its own flag and answers 404 while it is off.
const ENABLED = process.env.EXPO_PUBLIC_STORE_BILLING_ENABLED === 'true';
// Public SDK keys (not secrets). The Test Store key is for development without store accounts.
const API_KEY =
    process.env.EXPO_PUBLIC_REVENUECAT_TEST_KEY ||
    (Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY) ||
    '';

export type BillingStatus = 'off' | 'loading' | 'ready' | 'unavailable';
export type PurchaseResult = 'purchased' | 'cancelled';

interface BillingValue {
    readonly status: BillingStatus;
    readonly offerings: PurchasesOfferings | null;
    // True once this signed-in account's secret customer id is set; until then buying is refused,
    // because a purchase under an anonymous id could never be credited.
    readonly canPurchase: boolean;
    readonly publishActive: boolean;
    readonly generationActive: boolean;
    readonly generationAccessResolved: boolean;
    // Generation subscriptions fail closed until the server has conclusively ruled out an
    // existing web plan. Credit-pack purchases use canPurchase and remain independent.
    readonly generationPurchaseReady: boolean;
    readonly paidAccess: boolean;
    readonly accessResolved: boolean;
    readonly activeProductIds: readonly string[];
    readonly managementURL: string | null;
    // Development only: why the store could not be reached.
    readonly debug: string | null;
    purchase(pkg: PurchasesPackage): Promise<PurchaseResult>;
    purchaseStayOffer(pkg: PurchasesPackage): Promise<PurchaseResult>;
    restore(): Promise<void>;
    refreshGenerationAccess(): Promise<boolean>;
}

const BillingContext = createContext<BillingValue>({
    status: 'off', offerings: null, canPurchase: false, publishActive: false, generationActive: false, generationAccessResolved: false, generationPurchaseReady: false,
    paidAccess: false, accessResolved: false, activeProductIds: [], managementURL: null, debug: null,
    purchase: async () => 'cancelled', purchaseStayOffer: async () => 'cancelled', restore: async () => {}, refreshGenerationAccess: async () => false,
});

export const useBilling = () => useContext(BillingContext);

const isPublishActive = (info: CustomerInfo) => Boolean(info.entitlements.active.publish);
const isGenerationActive = (info: CustomerInfo) => Boolean(info.entitlements.active.generation);

export function BillingProvider({ children }: { children: ReactNode }) {
    const { status: authStatus, api } = useAuth();
    const [status, setStatus] = useState<BillingStatus>(ENABLED && API_KEY ? 'loading' : 'off');
    const [offerings, setOfferings] = useState<PurchasesOfferings | null>(null);
    const [canPurchase, setCanPurchase] = useState(false);
    const [publishActive, setPublishActive] = useState(false);
    const [generationActive, setGenerationActive] = useState(false);
    const [accessResolved, setAccessResolved] = useState(false);
    const [serverAccessResolved, setServerAccessResolved] = useState(false);
    const [serverPublishActive, setServerPublishActive] = useState(false);
    const [serverGenerationActive, setServerGenerationActive] = useState(false);
    const [serverGenerationResolved, setServerGenerationResolved] = useState(false);
    const [activeProductIds, setActiveProductIds] = useState<readonly string[]>([]);
    const [managementURL, setManagementURL] = useState<string | null>(null);
    const [debug, setDebug] = useState<string | null>(null);
    const configured = useRef(false);
    const loggedIn = useRef(false);

    const refreshGenerationAccess = useCallback(async (): Promise<boolean> => {
        const owner = getCacheUser();
        if (!owner) throw new Error('generation_access_unresolved');
        try {
            const generation = await api.request<{ subscription?: { status?: unknown } | null }>('/api/v1/subscriptions');
            if (owner !== getCacheUser()) throw new Error('generation_access_unresolved');
            const subscriptionStatus = generation?.subscription?.status;
            const active = subscriptionStatus === 'active' || subscriptionStatus === 'past_due';
            setServerGenerationActive(active);
            setServerGenerationResolved(true);
            return active;
        } catch (error) {
            if (owner === getCacheUser()) {
                setServerGenerationActive(false);
                setServerGenerationResolved(false);
            }
            throw error;
        }
    }, [api]);

    useEffect(() => {
        if (!ENABLED || !API_KEY) return;
        let cancelled = false;
        const onInfo = (info: CustomerInfo) => {
            setPublishActive(isPublishActive(info));
            setGenerationActive(isGenerationActive(info));
            setActiveProductIds(info.activeSubscriptions);
            setManagementURL(info.managementURL);
            setAccessResolved(true);
        };
        (async () => {
            try {
                if (!configured.current) {
                    Purchases.configure({ apiKey: API_KEY });
                    configured.current = true;
                    Purchases.addCustomerInfoUpdateListener(onInfo);
                }
                const all = await Purchases.getOfferings();
                if (!cancelled) {
                    setOfferings(all);
                    setStatus('ready');
                }
            } catch (err) {
                if (!cancelled) {
                    setStatus('unavailable');
                    if (__DEV__) setDebug(String((err as Error)?.message ?? err));
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // Bind the store customer to this account with the secret id only the signed-in app is told.
    useEffect(() => {
        if (!ENABLED || !API_KEY || !configured.current) return;
        let cancelled = false;
        (async () => {
            if (authStatus === 'signedIn') {
                try {
                    const { rc_customer_id } = await api.request<{ rc_customer_id: string }>('/api/v1/store-purchases/customer');
                    const { customerInfo } = await Purchases.logIn(rc_customer_id);
                    loggedIn.current = true;
                    if (!cancelled) {
                        setCanPurchase(true);
                        setPublishActive(isPublishActive(customerInfo));
                        setGenerationActive(isGenerationActive(customerInfo));
                        setActiveProductIds(customerInfo.activeSubscriptions);
                        setManagementURL(customerInfo.managementURL);
                        setAccessResolved(true);
                    }
                } catch (err) {
                    // 404 means the server flag is off: show the offer but never allow a purchase.
                    if (!cancelled) {
                        setCanPurchase(false);
                        setAccessResolved(true);
                    }
                    if (!(err instanceof ApiError && err.status === 404)) console.warn('[billing] customer id failed');
                }
            } else {
                setCanPurchase(false);
                setPublishActive(false);
                setGenerationActive(false);
                setAccessResolved(false);
                setActiveProductIds([]);
                setManagementURL(null);
                // logOut on an anonymous user is an SDK error, so only undo a login we made.
                if (loggedIn.current) {
                    loggedIn.current = false;
                    try {
                        await Purchases.logOut();
                    } catch {
                        // Already anonymous.
                    }
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [authStatus, api, status]);

    // A plan bought on the website or another store belongs to the same account. The server is
    // authoritative for those channels, so an existing customer is never asked to pay twice.
    useEffect(() => {
        let cancelled = false;
        if (authStatus !== 'signedIn') {
            void Promise.resolve().then(() => {
                if (cancelled) return;
                setServerAccessResolved(false);
                setServerPublishActive(false);
                setServerGenerationActive(false);
                setServerGenerationResolved(false);
            });
            return () => { cancelled = true; };
        }
        const generation = Promise.resolve().then(refreshGenerationAccess).then(() => true).catch(() => false);
        const publish = api.request<{ entitlement?: { tier?: unknown } }>('/api/v1/social/plan')
            .then((value) => {
                if (!cancelled) setServerPublishActive(value?.entitlement?.tier === 'publish');
                return true;
            })
            .catch(() => {
                if (!cancelled) setServerPublishActive(false);
                return false;
            });
        void Promise.all([generation, publish]).then(([generationResolved, publishResolved]) => {
            if (cancelled) return;
            setServerAccessResolved(generationResolved && publishResolved);
        });
        return () => { cancelled = true; };
    }, [authStatus, api, refreshGenerationAccess]);

    const purchase = useCallback(async (pkg: PurchasesPackage): Promise<PurchaseResult> => {
        if (!canPurchase) throw new Error('billing_not_ready');
        if (generationPlanFor(pkg.product.identifier) !== null && (generationActive || await refreshGenerationAccess())) {
            throw new Error('generation_already_active');
        }
        try {
            const { customerInfo } = await Purchases.purchasePackage(pkg);
            setPublishActive(isPublishActive(customerInfo));
            setGenerationActive(isGenerationActive(customerInfo));
            setActiveProductIds(customerInfo.activeSubscriptions);
            setManagementURL(customerInfo.managementURL);
            return 'purchased';
        } catch (err) {
            if ((err as { userCancelled?: boolean }).userCancelled) return 'cancelled';
            throw err;
        }
    }, [canPurchase, generationActive, refreshGenerationAccess]);

    const purchaseStayOffer = useCallback(async (pkg: PurchasesPackage): Promise<PurchaseResult> => {
        if (!canPurchase) throw new Error('billing_not_ready');
        if (!stayDiscountFor(pkg)) throw new Error('stay_offer_unavailable');
        const discount = pkg.product.discounts?.find((item) => item.identifier === 'stay15');
        if (!discount) throw new Error('stay_offer_unavailable');
        try {
            const offer = await Purchases.getPromotionalOffer(pkg.product, discount);
            if (!offer) throw new Error('stay_offer_ineligible');
            const { customerInfo } = await Purchases.purchaseDiscountedPackage(pkg, offer);
            setPublishActive(isPublishActive(customerInfo));
            setGenerationActive(isGenerationActive(customerInfo));
            setActiveProductIds(customerInfo.activeSubscriptions);
            setManagementURL(customerInfo.managementURL);
            return 'purchased';
        } catch (err) {
            if ((err as { userCancelled?: boolean }).userCancelled) return 'cancelled';
            throw err;
        }
    }, [canPurchase]);

    const restore = useCallback(async () => {
        if (!canPurchase) throw new Error('billing_not_ready');
        const info = await Purchases.restorePurchases();
        setPublishActive(isPublishActive(info));
        setGenerationActive(isGenerationActive(info));
        setActiveProductIds(info.activeSubscriptions);
        setManagementURL(info.managementURL);
        setAccessResolved(true);
    }, [canPurchase]);

    const publishEntitled = publishActive || serverPublishActive;
    const generationEntitled = generationActive || serverGenerationActive;
    const generationPurchaseReady = canPurchase && serverGenerationResolved && !generationEntitled;
    const paidAccess = publishEntitled || generationEntitled;
    const paidAccessResolved = accessResolved || serverAccessResolved;

    const value = useMemo(
        () => ({ status, offerings, canPurchase, publishActive: publishEntitled, generationActive: generationEntitled, generationAccessResolved: serverGenerationResolved, generationPurchaseReady, paidAccess, accessResolved: paidAccessResolved, activeProductIds, managementURL, debug, purchase, purchaseStayOffer, restore, refreshGenerationAccess }),
        [status, offerings, canPurchase, publishEntitled, generationEntitled, serverGenerationResolved, generationPurchaseReady, paidAccess, paidAccessResolved, activeProductIds, managementURL, debug, purchase, purchaseStayOffer, restore, refreshGenerationAccess],
    );
    return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}
