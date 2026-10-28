import { isAccountChanged, type SessionTask } from '../auth/sessionTask';
import { captureEvent } from '../lib/analytics/events';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import Purchases, { type CustomerInfo, type PurchasesOfferings, type PurchasesPackage } from 'react-native-purchases';
import { useAuth } from '../auth/AuthProvider';
import { ApiError } from '../lib/api';
import { revenueCatKey, generationPlanFor, stayDiscountFor } from '../lib/billing';
import { getCacheUser } from '../lib/appCache';
import { APP_ENV } from '../lib/config';

// Store billing is a build-time switch (ADR-0108); the server has its own flag and answers 404 while it is off.
const ENABLED = process.env.EXPO_PUBLIC_STORE_BILLING_ENABLED === 'true';
// Public SDK keys (not secrets). The Test Store key is for development without store accounts.
const API_KEY = revenueCatKey(__DEV__, APP_ENV, process.env.EXPO_PUBLIC_REVENUECAT_TEST_KEY,
    Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY);

export type BillingStatus = 'off' | 'loading' | 'ready' | 'unavailable';
export type PurchaseResult = 'purchased' | 'cancelled' | 'pending';

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
    restore(): Promise<boolean>;
    refreshGenerationAccess(): Promise<boolean>;
}

const BillingContext = createContext<BillingValue>({
    status: 'off', offerings: null, canPurchase: false, publishActive: false, generationActive: false, generationAccessResolved: false, generationPurchaseReady: false,
    paidAccess: false, accessResolved: false, activeProductIds: [], managementURL: null, debug: null,
    purchase: async () => 'cancelled', purchaseStayOffer: async () => 'cancelled', restore: async () => false, refreshGenerationAccess: async () => false,
});

export const useBilling = () => useContext(BillingContext);

const isPublishActive = (info: CustomerInfo) => Boolean(info.entitlements.active.publish);
const isGenerationActive = (info: CustomerInfo) => Boolean(info.entitlements.active.generation);

const emptyStore = (gen: number) => ({ gen, canPurchase: false, publishActive: false, generationActive: false,
    productIds: [] as readonly string[], managementURL: null as string | null, resolved: false });
const emptyServer = (gen: number) => ({ gen, resolved: false, publishActive: false, generationActive: false, generationResolved: false });
const storeInfo = (gen: number, info: CustomerInfo) => ({ gen, canPurchase: true, publishActive: isPublishActive(info),
    generationActive: isGenerationActive(info), productIds: info.activeSubscriptions, managementURL: info.managementURL, resolved: true });

export function BillingProvider({ children }: { children: ReactNode }) {
    const { status: authStatus, api, generation, beginSessionTask } = useAuth();
    const [status, setStatus] = useState<BillingStatus>(ENABLED && API_KEY ? 'loading' : 'off');
    const [offerings, setOfferings] = useState<PurchasesOfferings | null>(null);
    const [store, setStore] = useState(() => emptyStore(-1));
    const [server, setServer] = useState(() => emptyServer(-1));
    const currentStore = store.gen === generation ? store : emptyStore(generation);
    const currentServer = server.gen === generation ? server : emptyServer(generation);
    const { canPurchase, publishActive, generationActive, productIds: activeProductIds, managementURL, resolved: accessResolved } = currentStore;
    const { publishActive: serverPublishActive, generationActive: serverGenerationActive,
        generationResolved: serverGenerationResolved, resolved: serverAccessResolved } = currentServer;
    const [debug, setDebug] = useState<string | null>(null);
    const configured = useRef(false);
    const loggedIn = useRef(false);
    const bound = useRef<{ gen: number } | null>(null);
    const identityChain = useRef(Promise.resolve());

    const refreshGenerationAccess = useCallback(async (task: SessionTask = beginSessionTask()): Promise<boolean> => {
        if (!task.current()) return false;
        const owner = getCacheUser();
        if (!owner) throw new Error('generation_access_unresolved');
        try {
            const response = await api.request<{ subscription?: { status?: unknown } | null }>('/api/v1/subscriptions', {}, { task });
            if (!task.current()) return false;
            if (owner !== getCacheUser()) throw new Error('generation_access_unresolved');
            const subscriptionStatus = response?.subscription?.status;
            const active = subscriptionStatus === 'active' || subscriptionStatus === 'past_due';
            setServer(previous => ({ ...(previous.gen === task.gen ? previous : emptyServer(task.gen)), generationActive: active, generationResolved: true }));
            return active;
        } catch (error) {
            if (!task.current() || isAccountChanged(error)) return false;
            if (owner === getCacheUser()) {
                setServer(previous => ({ ...(previous.gen === task.gen ? previous : emptyServer(task.gen)), generationActive: false, generationResolved: false }));
            }
            throw error;
        }
    }, [api, beginSessionTask]);

    useEffect(() => {
        if (!ENABLED || !API_KEY) return;
        let cancelled = false;
        const onInfo = () => {
            const task = beginSessionTask();
            if (cancelled || bound.current?.gen !== task.gen) return;
            void Purchases.getCustomerInfo().then(info => {
                if (!cancelled && task.current() && bound.current?.gen === task.gen) setStore(storeInfo(task.gen, info));
            }).catch(() => undefined);
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
    }, [beginSessionTask]);

    // Serialize SDK identities: a late login must finish before the next login/logout.
    useEffect(() => {
        const task = beginSessionTask();
        if (task.gen !== generation || !task.current() || !ENABLED || !API_KEY || !configured.current) return;
        let cancelled = false;
        const live = () => !cancelled && task.current();
        const enqueue = (step: () => Promise<void>) => {
            identityChain.current = identityChain.current.then(step).catch(err => {
                if (!live() || isAccountChanged(err)) return;
                setStore({ ...emptyStore(task.gen), resolved: true });
                if (!(err instanceof ApiError && err.status === 404)) console.warn('[billing] customer id failed');
            });
        };
        if (authStatus === 'signedIn') {
            void api.request<{ rc_customer_id: string }>('/api/v1/store-purchases/customer', {}, { task }).then(({ rc_customer_id }) => {
                if (!live()) return;
                enqueue(async () => {
                    if (!live()) return;
                    if (bound.current?.gen !== task.gen) bound.current = null;
                    const { customerInfo } = await Purchases.logIn(rc_customer_id);
                    loggedIn.current = true;
                    if (!live()) return;
                    bound.current = { gen: task.gen };
                    setStore(storeInfo(task.gen, customerInfo));
                });
            }).catch(err => {
                if (!live() || isAccountChanged(err)) return;
                setStore({ ...emptyStore(task.gen), resolved: true });
                if (!(err instanceof ApiError && err.status === 404)) console.warn('[billing] customer id failed');
            });
        } else {
            setStore(emptyStore(task.gen));
            enqueue(async () => {
                if (!live()) return;
                bound.current = null;
                if (loggedIn.current) {
                    loggedIn.current = false;
                    await Purchases.logOut().catch(() => undefined);
                }
            });
        }
        return () => { cancelled = true; };
    }, [authStatus, api, status, generation, beginSessionTask]);

    // Website and other-store access is owned by the same rendered generation.
    useEffect(() => {
        const task = beginSessionTask();
        if (task.gen !== generation || !task.current()) return;
        let cancelled = false;
        const live = () => !cancelled && task.current();
        if (authStatus !== 'signedIn') {
            setServer(emptyServer(task.gen));
            return () => { cancelled = true; };
        }
        const generationResult = refreshGenerationAccess(task).then(() => true).catch(() => false);
        const publish = api.request<{ entitlement?: { tier?: unknown } }>('/api/v1/social/plan', {}, { task })
            .then(value => {
                if (live()) setServer(previous => ({ ...(previous.gen === task.gen ? previous : emptyServer(task.gen)), publishActive: value?.entitlement?.tier === 'publish' }));
                return true;
            })
            .catch(() => {
                if (live()) setServer(previous => ({ ...(previous.gen === task.gen ? previous : emptyServer(task.gen)), publishActive: false }));
                return false;
            });
        void Promise.all([generationResult, publish]).then(([generationResolved, publishResolved]) => {
            if (live()) setServer(previous => ({ ...(previous.gen === task.gen ? previous : emptyServer(task.gen)), resolved: generationResolved && publishResolved }));
        });
        return () => { cancelled = true; };
    }, [authStatus, api, refreshGenerationAccess, generation, beginSessionTask]);

    const purchase = useCallback(async (pkg: PurchasesPackage): Promise<PurchaseResult> => {
        const task = beginSessionTask();
        if (!canPurchase || bound.current?.gen !== task.gen) throw new Error('billing_not_ready');
        if (generationPlanFor(pkg.product.identifier) !== null && (generationActive || await refreshGenerationAccess(task))) {
            if (!task.current()) return 'cancelled';
            throw new Error('generation_already_active');
        }
        if (!task.current()) return 'cancelled';
        const product = pkg.product.subscriptionPeriod ? 'subscription' : 'pack';
        captureEvent('purchase_started', { product });
        let purchased = false;
        try {
            const result = await Purchases.purchasePackage(pkg);
            purchased = true;
            if (!task.current()) return 'purchased';
            setStore(storeInfo(task.gen, result.customerInfo));
            captureEvent('purchase_finished', { product, outcome: 'succeeded' });
            return 'purchased';
        } catch (err) {
            if (purchased) return task.current() ? 'pending' : 'purchased';
            if (task.current()) captureEvent('purchase_finished', { product, outcome: (err as { userCancelled?: boolean }).userCancelled ? 'cancelled' : 'failed' });
            if ((err as { userCancelled?: boolean }).userCancelled) return 'cancelled';
            throw err;
        }
    }, [canPurchase, generationActive, refreshGenerationAccess, beginSessionTask]);

    const purchaseStayOffer = useCallback(async (pkg: PurchasesPackage): Promise<PurchaseResult> => {
        const task = beginSessionTask();
        if (!canPurchase || bound.current?.gen !== task.gen) throw new Error('billing_not_ready');
        if (!stayDiscountFor(pkg)) throw new Error('stay_offer_unavailable');
        const product = 'subscription';
        const discount = pkg.product.discounts?.find((item) => item.identifier === 'stay15');
        if (!discount) throw new Error('stay_offer_unavailable');
        try {
            const offer = await Purchases.getPromotionalOffer(pkg.product, discount);
            if (!task.current()) return 'cancelled';
            if (!offer) throw new Error('stay_offer_ineligible');
            captureEvent('purchase_started', { product });
            const { customerInfo } = await Purchases.purchaseDiscountedPackage(pkg, offer);
            if (!task.current()) return 'purchased';
            setStore(storeInfo(task.gen, customerInfo));
            captureEvent('purchase_finished', { product, outcome: 'succeeded' });
            return 'purchased';
        } catch (err) {
            if (task.current()) captureEvent('purchase_finished', { product, outcome: (err as { userCancelled?: boolean }).userCancelled ? 'cancelled' : 'failed' });
            if ((err as { userCancelled?: boolean }).userCancelled) return 'cancelled';
            throw err;
        }
    }, [canPurchase, beginSessionTask]);

    const restore = useCallback(async () => {
        const task = beginSessionTask();
        if (!canPurchase || bound.current?.gen !== task.gen) throw new Error('billing_not_ready');
        const info = await Purchases.restorePurchases();
        if (!task.current()) return false;
        setStore(storeInfo(task.gen, info));
        return Object.keys(info.entitlements.active).length > 0 || info.activeSubscriptions.length > 0;
    }, [canPurchase, beginSessionTask]);

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
