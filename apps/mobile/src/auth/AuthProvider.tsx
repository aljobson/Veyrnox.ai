import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { createApiClient, API_BASE, type ApiClient } from '../lib/api';
import { AUTH_REDIRECT_URL } from '../lib/config';
import { createAppleNonce, createPkce } from '../lib/auth/pkce';
import { clearRefreshToken, readRefreshToken, writeRefreshToken } from '../lib/auth/sessionStore';
import {
    authorizeUrl,
    exchangeAuthCode,
    refreshSession,
    revokeSession,
    signInWithIdToken,
    type OAuthProvider,
    type Session,
} from '../lib/auth/supabaseAuth';

WebBrowser.maybeCompleteAuthSession();

// Refresh this long before expiry so a request never leaves with a dying token.
const REFRESH_SKEW_MS = 60_000;

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthContextValue {
    readonly status: Status;
    readonly api: ApiClient;
    readonly appleNativeAvailable: boolean;
    signInWithApple(): Promise<void>;
    signInWithOAuth(provider: OAuthProvider): Promise<void>;
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
    const refreshInFlight = useRef<Promise<Session | null> | null>(null);

    const adopt = useCallback(async (session: Session) => {
        sessionRef.current = session;
        await writeRefreshToken(session.refreshToken);
        setStatus('signedIn');
    }, []);

    const drop = useCallback(async () => {
        sessionRef.current = null;
        await clearRefreshToken();
        setStatus('signedOut');
    }, []);

    // One refresh at a time: Supabase rotates refresh tokens, so two parallel
    // refreshes would make the second fail and sign the user out.
    const refresh = useCallback((): Promise<Session | null> => {
        if (refreshInFlight.current) return refreshInFlight.current;
        const run = (async () => {
            const stored = sessionRef.current?.refreshToken ?? (await readRefreshToken());
            if (!stored) return null;
            try {
                const next = await refreshSession(stored);
                await adopt(next);
                return next;
            } catch (err) {
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

    const api = useMemo(
        () => createApiClient({ baseUrl: API_BASE, getAccessToken, onSessionLost: () => void drop() }),
        [getAccessToken, drop],
    );

    useEffect(() => {
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
                authorizeUrl(provider, pkce.challenge, AUTH_REDIRECT_URL),
                AUTH_REDIRECT_URL,
            );
            if (result.type !== 'success') return;
            const code = new URL(result.url).searchParams.get('code');
            if (!code) throw new Error('oauth_no_code');
            await adopt(await exchangeAuthCode(code, pkce.verifier));
        },
        [adopt],
    );

    const signOut = useCallback(async () => {
        const token = sessionRef.current?.accessToken;
        await drop();
        if (token) await revokeSession(token);
    }, [drop]);

    const value = useMemo<AuthContextValue>(
        () => ({ status, api, appleNativeAvailable, signInWithApple, signInWithOAuth, signOut }),
        [status, api, appleNativeAvailable, signInWithApple, signInWithOAuth, signOut],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
