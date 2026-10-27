import { reloadAppAsync } from 'expo';
import { I18nManager } from 'react-native';
declare const require: (id: string) => any;
const secureStore = (): typeof import('expo-secure-store') => require('expo-secure-store');
import { getLocale, isRtl, type LocaleCode } from './i18n';

// Separate from LANGUAGE_SLOT: automatic repair must not manufacture an explicit choice
// or consume pendingAccountSync. One durable record atomically prepares locale + route + guard.
export const DIRECTION_SLOT = 'veyrnox.language.direction.v1';
interface Repair { locale: LocaleCode; returnPath: string }
export interface DirectionDependencies {
    read(): Promise<string | null>;
    write(value: string | null): Promise<void>;
    nativeRtl(): boolean;
    direction(rtl: boolean): void;
    reload(): Promise<void>;
}
const defaults: DirectionDependencies = {
    read: () => secureStore().getItemAsync(DIRECTION_SLOT),
    write: value => value === null ? secureStore().deleteItemAsync(DIRECTION_SLOT) : secureStore().setItemAsync(DIRECTION_SLOT, value),
    nativeRtl: () => I18nManager.isRTL,
    direction: rtl => { I18nManager.allowRTL(rtl); I18nManager.forceRTL(rtl); },
    reload: () => reloadAppAsync('Veyrnox language direction repaired'),
};
function parse(raw: string | null): Repair | null {
    try {
        const value = JSON.parse(raw ?? 'null');
        return value && typeof value.locale === 'string' && typeof value.returnPath === 'string'
            && value.returnPath.startsWith('/') && !value.returnPath.startsWith('//') ? value : null;
    } catch { return null; }
}

// Preserve deep-link parameters as well as the pathname. Dynamic segment parameters
// are already in the pathname; only search parameters belong in the query string.
export function languageReturnPath(pathname: string, params: Record<string, string | string[] | undefined>, segments: readonly string[]): string {
    const pathParams = new Set(segments.flatMap(segment => {
        const match = segment.match(/^\[\[?(?:\.\.\.)?([^\]]+)\]\]?$/);
        return match ? [match[1]] : [];
    }));
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (key === '#' || pathParams.has(key) || value === undefined) continue;
        for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
    }
    const search = query.toString();
    const fragment = typeof params['#'] === 'string' ? '#' + encodeURIComponent(params['#']) : '';
    return pathname + (search ? '?' + search : '') + fragment;
}

// A factory permits tests to model a fresh runtime against the same durable storage.
export function createDirectionReconciler(deps: DirectionDependencies = defaults) {
    let attempted = false;
    let reloadRequested = false;
    let handledRepair = false;
    let pending: Promise<boolean> | null = null;
    let returnPath: string | null = null;
    async function run(locale: LocaleCode, path: string, session: { signedIn: boolean; canReloadSession(): boolean }): Promise<boolean> {
        const target = isRtl(locale);
        const native = deps.nativeRtl();
        if (attempted) return target === native;
        attempted = true;
        let directed = false;
        let prepared = false;
        try {
            const prior = parse(await deps.read());
            if (prior) {
                handledRepair = true;
                await deps.write(null);
                if (prior.locale === locale) returnPath = prior.returnPath;
                // A reload that did not apply the native setting must not start a reload loop.
                return target === native;
            }
            if (target === native) return true;
            if (session.signedIn && !session.canReloadSession()) {
                attempted = false;
                return false;
            }
            await deps.write(JSON.stringify({ locale, returnPath: path } satisfies Repair));
            prepared = true;
            handledRepair = true;
            if (session.signedIn && !session.canReloadSession()) {
                await deps.write(null);
                handledRepair = false;
                attempted = false;
                return false;
            }
            directed = true;
            deps.direction(target);
            reloadRequested = true;
            await deps.reload();
            return true;
        } catch {
            // Rejected reload/storage: keep this runtime usable, and retry on a future launch.
            reloadRequested = false;
            try { if (directed) deps.direction(native); } catch { /* Native settings may be unavailable. */ }
            try { if (prepared) await deps.write(null); } catch { /* Retaining the guard is safer than looping. */ }
            return target === native;
        }
    }
    return {
        reconcile(locale: LocaleCode, path: string, session: { signedIn: boolean; canReloadSession(): boolean }) {
            if (pending) return pending;
            pending = run(locale, path, session).finally(() => { pending = null; });
            return pending;
        },
        // An explicit selection must not race an automatic repair already in flight.
        async beforeChoice() { await pending; return !reloadRequested; },
        handledRepair: () => handledRepair,
        reloadRequested: () => reloadRequested,
        takeReturnPath() { const path = returnPath; returnPath = null; return path; },
    };
}
export const directionReconciler = createDirectionReconciler();
export const reconcileLanguageDirection = (path: string, session: { signedIn: boolean; canReloadSession(): boolean }) =>
    directionReconciler.reconcile(getLocale(), path, session);
