// Load only when used: older development clients do not contain this native module.
type NativePasskeys = typeof import('react-native-passkeys');
const native = (): NativePasskeys => require('react-native-passkeys');
export type CreationOptions = Parameters<NativePasskeys['create']>[0];
export type RequestOptions = Parameters<NativePasskeys['get']>[0];
export type CeremonyKind = 'unsupported' | 'no_credential' | 'setup' | 'busy' | 'failed';

export class PasskeyCeremonyError extends Error {
    constructor(readonly kind: CeremonyKind) {
        super('passkey_ceremony');
        this.name = 'PasskeyCeremonyError';
    }
}

export function classifyNativeError(err: unknown): CeremonyKind | 'cancelled' {
    const value = err && typeof err === 'object' ? err as { code?: unknown; message?: unknown } : {};
    const text = [value.code, value.message, typeof err === 'string' ? err : ''].filter((v) => typeof v === 'string').join(' ');
    if (/cancel/i.test(text)) return 'cancelled';
    if (/NoCredentials/i.test(text)) return 'no_credential';
    if (/NotConfigured|ERR_NOT_CONFIGURED/i.test(text)) return 'setup';
    if (/NotSupported|ERR_NOT_SUPPORTED|ERR_BIOMETRIC/i.test(text)) return 'unsupported';
    if (/ERR_PENDING_PASSKEY_REQUEST|Interrupted/i.test(text)) return 'busy';
    return 'failed';
}

export function nativePasskeysSupported(): boolean {
    try { return native().isSupported(); } catch { return false; }
}

async function ceremony<T>(run: () => Promise<T | null>): Promise<T | null> {
    try { return await run(); } catch (err) {
        const kind = classifyNativeError(err);
        if (kind === 'cancelled') return null;
        throw new PasskeyCeremonyError(kind);
    }
}

export const createCredential = (options: CreationOptions) => ceremony(() => native().create(options));
export const getCredential = (options: RequestOptions) => ceremony(() => native().get(options));
