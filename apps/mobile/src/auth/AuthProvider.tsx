import { claimLegacyOddlings } from '../lib/oddlingsAccountStore';
import { setOwner as setCinemaUploadOwner } from '../lib/cinemaUploadStore';
import { passkeyGate, toGoTrueCredential, validatePasskeyOptions } from '../lib/passkeys';
import { getCredential } from '../lib/auth/passkeyNative';
import * as AppleAuthentication from 'expo-apple-authentication';
import { fetch as expoFetch } from 'expo/fetch';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { createApiClient, API_BASE, type ApiClient } from '../lib/api';
import { AUTH_REDIRECT_URL, OAUTH_BRIDGE_URL } from '../lib/config';
import { apiTokenSource, isTransientRefreshFailure } from '../lib/auth/apiToken';
import { createAppleNonce, createPkce } from '../lib/auth/pkce';
import { aiConsent } from '../lib/aiConsentStore';
import { forgetMfaCleared } from '../lib/mfaCheck';
import { bindCacheUser, clearExportFiles, userIdFromToken, wipeCache } from '../lib/appCache';
import { cinemaProgressIdentity } from '../lib/cinemaProgress';
import { clearRefreshToken, readRefreshToken, writeRefreshToken } from '../lib/auth/sessionStore';
import {
    passkeySignInOptions,
    passkeySignInVerify,
    authorizeUrl,
    exchangeAuthCode,
    refreshSession,
    revokeSession,
    signInWithIdToken,
    signInWithPassword,
    signUpWithPassword,
    type OAuthProvider,
    type Session,
} from '../lib/auth/supabaseAuth';

WebBrowser.maybeCompleteAuthSession();

// Refresh this long before expiry so a request never leaves with a dying token.
const REFRESH_SKEW_MS = 60_000;
let exportFilesCleared = false;

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthContextValue {
    readonly status: Status;
    readonly api: ApiClient;
    // Shared by account-bound transports: clear local auth without remote revocation.
    readonly onSessionLost: () => void;
    // For account calls that go to Supabase Auth directly (lib/auth/accountCalls.ts).
    getAccessToken(forceRefresh?: boolean): Promise<string | null>;
    // Makes a session the live one: the step-up after a second-factor code returns a fresh token pair.
    adoptSession(session: Session): Promise<void>;
    readonly appleNativeAvailable: boolean;
    signInWithApple(): Promise<void>;
    signInWithOAuth(provider: OAuthProvider): Promise<void>;
    signInWithEmail(email: string, password: string, captchaToken: string): Promise<void>;
    // Resolves true when signed in, false when the user must confirm their email first.
    signUpWithEmail(email: string, password: string, captchaToken: string): Promise<boolean>;
    signInWithPasskey(captchaToken: string): Promise<boolean>;
    signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
    const value = useContext(AuthContext);
    if (!value) throw new Error('useAuth must be used inside AuthProvider');
    return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<Status>('loading');
    const [appleNativeAvailable, setAppleNativeAvailable] = useState(false);
    const sessionRef = useRef<Session | null>(null);
    const transientFailure = useRef(false);
    const dropped = useRef(false);
    const refreshInFlight = useRef<Promise<Session | null> | null>(null);

    const adopt = useCallback(async (session: Session) => {
        sessionRef.current = session;
        dropped.current = false;
        transientFailure.current = false;
        const userId = userIdFromToken(session.accessToken);
        cinemaProgressIdentity.setUser(userId);
        aiConsent.setUser(userId);
        await bindCacheUser(userId);
        await setCinemaUploadOwner(userId).catch(() => undefined);
        await claimLegacyOddlings(userId).catch(() => undefined);
        // A valid remote session must become usable even when the native
        // credential store is temporarily unavailable (for example, an
        // ad-hoc simulator build without a Keychain access group). The
        // access token remains memory-only; a later refresh can retry the
        // persistence step without trapping the user on the sign-in screen.
        try {
            await writeRefreshToken(session.refreshToken);
        } catch {
            // The in-memory session remains valid for this app run.
        }
        setStatus('signedIn');
    }, []);

    const drop = useCallback(async () => {
        // A refresh rejection and the request's session-loss callback can both arrive.
        if (dropped.current) return;
        dropped.current = true;
        sessionRef.current = null;
        transientFailure.current = false;
        cinemaProgressIdentity.setUser(null);
        forgetMfaCleared();
        await aiConsent.forget();
        await wipeCache().catch(() => undefined);
        await setCinemaUploadOwner(null).catch(() => undefined);
        await clearRefreshToken();
        setStatus('signedOut');
    }, []);

    // One refresh at a time: Supabase rotates refresh tokens, so two parallel
    // refreshes would make the second fail and sign the user out.
    const refresh = useCallback((): Promise<Session | null> => {
        if (refreshInFlight.current) return refreshInFlight.current;
        const run = (async () => {
            const stored = sessionRef.current?.refreshToken ?? (await readRefreshToken());
            if (!stored) { transientFailure.current = false; return null; }
            try {
                const next = await refreshSession(stored);
                await adopt(next);
                return next;
            } catch (err) {
                transientFailure.current = isTransientRefreshFailure(err);
                // A rejected token is final; a network error keeps the stored token for next launch.
                if (err instanceof Error && 'status' in err && (err as { status: number }).status !== 0) await drop();
                return null;
            }
        })().finally(() => {
            refreshInFlight.current = null;
        });
        refreshInFlight.current = run;
        return run;
    }, [adopt, drop]);

    const getAccessToken = useCallback(
        async (forceRefresh = false): Promise<string | null> => {
            const current = sessionRef.current;
            if (current && !forceRefresh && current.expiresAt - Date.now() > REFRESH_SKEW_MS) return current.accessToken;
            const next = await refresh();
            return next ? next.accessToken : null;
        },
        [refresh],
    );

    const onSessionLost = useCallback(() => void drop(), [drop]);

    const api = useMemo(
        () => createApiClient({
                baseUrl: API_BASE,
                getAccessToken: apiTokenSource(getAccessToken, () => transientFailure.current),
                onSessionLost,
                streamFetch: expoFetch as unknown as typeof fetch,
                beforeSend: aiConsent.ensure,
            }),
        [getAccessToken, onSessionLost],
    );

    useEffect(() => {
        if (!exportFilesCleared) { clearExportFiles(); exportFilesCleared = true; }
        let cancelled = false;
        void (async () => {
            const next = await refresh();
            if (!cancelled && !next && !sessionRef.current) setStatus('signedOut');
        })();
        if (Platform.OS === 'ios') {
            void AppleAuthentication.isAvailableAsync().then((ok) => !cancelled && setAppleNativeAvailable(ok));
        }
        return () => {
            cancelled = true;
        };
    }, [refresh]);

    const signInWithApple = useCallback(async () => {
        const nonce = await createAppleNonce();
        let credential: AppleAuthentication.AppleAuthenticationCredential;
        try {
            credential = await AppleAuthentication.signInAsync({
                requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
                nonce: nonce.hashed,
            });
        } catch (err) {
            if ((err as { code?: string }).code === 'ERR_REQUEST_CANCELED') return;
            throw err;
        }
        if (!credential.identityToken) throw new Error('apple_no_identity_token');
        await adopt(await signInWithIdToken('apple', credential.identityToken, nonce.raw));
    }, [adopt]);

    const signInWithOAuth = useCallback(
        async (provider: OAuthProvider) => {
            const pkce = await createPkce();
            const result = await WebBrowser.openAuthSessionAsync(
                authorizeUrl(provider, pkce.challenge, OAUTH_BRIDGE_URL),
                AUTH_REDIRECT_URL,
            );
            if (result.type !== 'success') return;
            const code = new URL(result.url).searchParams.get('code');
            if (!code) throw new Error('oauth_no_code');
            await adopt(await exchangeAuthCode(code, pkce.verifier));
        },
        [adopt],
    );

    const signInWithEmail = useCallback(
        async (email: string, password: string, captchaToken: string) => {
            await adopt(await signInWithPassword(email, password, captchaToken));
        },
        [adopt],
    );

    const signUpWithEmail = useCallback(
        async (email: string, password: string, captchaToken: string) => {
            const session = await signUpWithPassword(email, password, captchaToken);
            if (!session) return false;
            await adopt(session);
            return true;
        },
        [adopt],
    );

    const signInWithPasskey = useCallback(async (captchaToken: string): Promise<boolean> => {
        if (!passkeyGate()) return false;
        const { challengeId, options } = validatePasskeyOptions(await passkeySignInOptions(captchaToken), false);
        const credential = await getCredential(options);
        if (credential === null) return false;
        await adopt(await passkeySignInVerify(challengeId, toGoTrueCredential(credential)));
        return true;
    }, [adopt]);

    const signOut = useCallback(async () => {
        const token = sessionRef.current?.accessToken;
        await drop();
        if (token) await revokeSession(token);
    }, [drop]);

    const value = useMemo<AuthContextValue>(
        () => ({ status, api, onSessionLost, getAccessToken, adoptSession: adopt, appleNativeAvailable, signInWithApple, signInWithOAuth, signInWithEmail, signUpWithEmail, signInWithPasskey, signOut }),
        [status, api, onSessionLost, getAccessToken, adopt, appleNativeAvailable, signInWithApple, signInWithOAuth, signInWithEmail, signUpWithEmail, signInWithPasskey, signOut],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
