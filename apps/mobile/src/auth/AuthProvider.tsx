import { clearAllVibes } from '../lib/creatorProfileStore';
import { tokenUser, isAccountChanged } from '../lib/auth/tokenUser';
import type { TokenSource } from '../lib/auth/accountCalls';
import type { SessionTask } from './sessionTask';
import { captureIssue } from '../lib/crash';
import { SessionReadError } from '../lib/auth/sessionStore';
import { setEditorMediaOwner } from '../lib/editorDeviceMedia';
import { captureEvent, setAnalyticsUser } from '../lib/analytics';
import { setFirstRunUser } from '../lib/firstRunPending';
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
import { AUTH_REDIRECT_URL } from '../lib/config';
import { apiTokenSource, isTransientRefreshFailure } from '../lib/auth/apiToken';
import { createAppleNonce, createPkce } from '../lib/auth/pkce';
import { aiConsent } from '../lib/aiConsentStore';
import { forgetMfaCleared } from '../lib/mfaCheck';
import { bindCacheUser, clearExportFiles, userIdFromToken, wipeCache } from '../lib/appCache';
import { cinemaProgressIdentity } from '../lib/cinemaProgress';
import { clearRefreshToken, readRefreshToken, writeRefreshToken } from '../lib/auth/sessionStore';
import {
    AuthError,
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
    readonly generation: number;
    sessionGeneration(): number;
    beginSessionTask(): SessionTask;
    canReloadSession(): boolean;
    readonly api: ApiClient;
    // Shared by account-bound transports: clear local auth without remote revocation.
    readonly onSessionLost: (generation?: number) => void;
    // For account calls that go to Supabase Auth directly (lib/auth/accountCalls.ts).
    readonly getAccessToken: TokenSource;
    // Makes a session the live one: the step-up after a second-factor code returns a fresh token pair.
    adoptSession(session: Session, expected?: number): Promise<void>;
    readonly appleNativeAvailable: boolean;
    signInWithApple(): Promise<void>;
    signInWithOAuth(provider: OAuthProvider): Promise<void>;
    signInWithEmail(email: string, password: string, captchaToken: string): Promise<void>;
    // Resolves true when signed in, false when the user must confirm their email first.
    signUpWithEmail(email: string, password: string, captchaToken: string): Promise<boolean>;
    signInWithPasskey(captchaToken: string): Promise<boolean>;
    signOut(expected?: number): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
    const value = useContext(AuthContext);
    if (!value) throw new Error('useAuth must be used inside AuthProvider');
    return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const generationRef = useRef(0);
    const [generation, setGeneration] = useState(0);
    const sessionGeneration = useCallback(() => generationRef.current, []);
    const [status, setStatus] = useState<Status>('loading');
    const [appleNativeAvailable, setAppleNativeAvailable] = useState(false);
    const sessionRef = useRef<Session | null>(null);
    const persistedRefresh = useRef<string | null>(null);
    const transientFailure = useRef(false);
    const dropped = useRef(false);
    const refreshInFlight = useRef<{ run: Promise<Session | null>; gen: number; from: Session | null } | null>(null);
    // Notify effects when durability changes even if status remains signedIn.
    const [sessionRevision, setSessionRevision] = useState(0);
    const canReloadSession = useCallback(() => !!sessionRef.current && persistedRefresh.current === sessionRef.current.refreshToken && !refreshInFlight.current, [sessionRevision]);

    const adopt = useCallback(async (session: Session) => {
        if (!sessionRef.current || tokenUser(session.accessToken) !== tokenUser(sessionRef.current.accessToken)) {
            generationRef.current += 1; setGeneration(generationRef.current);
        }
        const gen = generationRef.current;
        const live = () => {
            if (generationRef.current !== gen) throw new AuthError(401, 'account_changed');
            return sessionRef.current === session;
        };
        sessionRef.current = session;
        dropped.current = false;
        transientFailure.current = false;
        const userId = userIdFromToken(session.accessToken);
        setAnalyticsUser(userId);
        setFirstRunUser(userId);
        cinemaProgressIdentity.setUser(userId);
        aiConsent.setUser(userId);
        await bindCacheUser(userId);
        if (!live()) return;
        await setCinemaUploadOwner(userId).catch(() => undefined);
        if (!live()) return;
        await setEditorMediaOwner(userId).catch(() => undefined);
        if (!live()) return;
        await claimLegacyOddlings(userId).catch(() => undefined);
        if (!live()) return;
        // A valid remote session must become usable even when the native
        // credential store is temporarily unavailable (for example, an
        // ad-hoc simulator build without a Keychain access group). The
        // access token remains memory-only; a later refresh can retry the
        // persistence step without trapping the user on the sign-in screen.
        try {
            await writeRefreshToken(session.refreshToken);
            if (!live()) return;
            persistedRefresh.current = session.refreshToken;
        } catch (err) {
            if (isAccountChanged(err)) throw err;
            // The in-memory session remains valid if persistence failed.
        }
        if (!live()) return;
        setStatus('signedIn');
        setSessionRevision(value => value + 1);
    }, []);

    const drop = useCallback(async () => {
        // A refresh rejection and the request's session-loss callback can both arrive.
        if (dropped.current) return;
        generationRef.current += 1; setGeneration(generationRef.current);
        const gen = generationRef.current;
        dropped.current = true;
        setAnalyticsUser(null);
        setFirstRunUser(null);
        sessionRef.current = null;
        persistedRefresh.current = null;
        transientFailure.current = false;
        cinemaProgressIdentity.setUser(null);
        forgetMfaCleared();
        await aiConsent.forget();
        if (generationRef.current !== gen) return;
        await wipeCache().catch(() => undefined);
        if (generationRef.current !== gen) return;
        await clearAllVibes().catch(() => undefined);
        if (generationRef.current !== gen) return;
        await setCinemaUploadOwner(null).catch(() => undefined);
        if (generationRef.current !== gen) return;
        await setEditorMediaOwner(null).catch(() => undefined);
        if (generationRef.current !== gen) return;
        await clearRefreshToken();
        if (generationRef.current !== gen) return;
        setStatus('signedOut');
        setSessionRevision(value => value + 1);
    }, []);

    // Only callers starting from the same session join a rotating-token refresh.
    const refresh = useCallback((): Promise<Session | null> => {
        const gen = generationRef.current;
        const from = sessionRef.current;
        const existing = refreshInFlight.current;
        if (existing?.gen === gen && existing.from === from) return existing.run;
        const live = () => generationRef.current === gen && sessionRef.current === from;
        const superseded = () => generationRef.current === gen ? sessionRef.current : null;
        const run = (async () => {
            if (!from && gen !== 0) return null;
            let stored = from?.refreshToken;
            if (!stored) {
                for (let attempt = 0; attempt < 3; attempt++) {
                    try { stored = (await readRefreshToken()) ?? undefined; break; }
                    catch (error) {
                        if (!live()) return superseded();
                        if (!(error instanceof SessionReadError)) throw error;
                        if (attempt < 2) {
                            await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
                            if (!live()) return superseded();
                        } else {
                            transientFailure.current = true;
                            captureIssue('session_read_failed', {});
                            return null;
                        }
                    }
                }
                if (!live()) return superseded();
            }
            if (!stored) { transientFailure.current = false; return null; }
            try {
                const next = await refreshSession(stored);
                if (!live()) return superseded();
                const adoption = adopt(next);
                const adoptedGen = generationRef.current;
                await adoption;
                return generationRef.current === adoptedGen ? sessionRef.current : null;
            } catch (err) {
                if (isAccountChanged(err)) return null;
                if (!live()) return superseded();
                transientFailure.current = isTransientRefreshFailure(err);
                // A rejected token is final; a network error keeps it for the next launch.
                if (err instanceof Error && 'status' in err && (err as { status: number }).status !== 0) await drop();
                return null;
            }
        })().finally(() => {
            if (refreshInFlight.current?.run === run) {
                refreshInFlight.current = null;
                setSessionRevision(value => value + 1);
            }
        });
        refreshInFlight.current = { run, gen, from };
        return run;
    }, [adopt, drop]);

    const getAccessToken: TokenSource = useMemo(() => Object.assign(
        async (forceRefresh = false, expected?: number): Promise<string | null> => {
            if (expected !== undefined && expected !== generationRef.current) throw new AuthError(401, 'account_changed');
            const current = sessionRef.current;
            if (current && !forceRefresh && current.expiresAt - Date.now() > REFRESH_SKEW_MS) return current.accessToken;
            const next = await refresh();
            return next ? next.accessToken : null;
        }, { generation: () => generationRef.current }), [refresh]);

    const beginSessionTask = useCallback((): SessionTask => {
        const gen = generationRef.current;
        const user = sessionRef.current ? tokenUser(sessionRef.current.accessToken) : null;
        return {
            gen, user,
            current: () => generationRef.current === gen && (sessionRef.current ? tokenUser(sessionRef.current.accessToken) : null) === user,
            tokens: Object.assign((force?: boolean, expected?: number) => getAccessToken(force, expected ?? gen),
                { generation: getAccessToken.generation, expected: gen }),
        };
    }, [getAccessToken]);

    const adoptSession = useCallback(async (session: Session, expected?: number) => {
        if (expected !== undefined && (expected !== generationRef.current || !sessionRef.current ||
            tokenUser(session.accessToken) !== tokenUser(sessionRef.current.accessToken))) throw new AuthError(401, 'account_changed');
        await adopt(session);
    }, [adopt]);

    const onSessionLost = useCallback((expected?: number) => {
        if (expected !== undefined && expected !== generationRef.current) return;
        if (!transientFailure.current) void drop();
    }, [drop]);

    const api = useMemo(
        () => createApiClient({
                baseUrl: API_BASE,
                beginSessionTask,
                getAccessToken: apiTokenSource(getAccessToken, () => transientFailure.current),
                onSessionLost,
                streamFetch: expoFetch as unknown as typeof fetch,
                beforeSend: aiConsent.ensure,
            }),
        [getAccessToken, onSessionLost, beginSessionTask],
    );

    useEffect(() => {
        if (!exportFilesCleared) { clearExportFiles(); exportFilesCleared = true; }
        let cancelled = false;
        const gen = generationRef.current;
        void (async () => {
            const next = await refresh();
            if (!cancelled && generationRef.current === gen && !next && !sessionRef.current) setStatus('signedOut');
        })();
        if (Platform.OS === 'ios') {
            void AppleAuthentication.isAvailableAsync().then((ok) => !cancelled && setAppleNativeAvailable(ok));
        }
        return () => {
            cancelled = true;
        };
    }, [refresh]);

    const finishSignIn = useCallback(async (session: Session, gen: number): Promise<number | null> => {
        if (generationRef.current !== gen) return null;
        const adoption = adopt(session);
        const adoptedGen = generationRef.current;
        try { await adoption; }
        catch (err) { if (isAccountChanged(err)) return null; throw err; }
        return adoptedGen;
    }, [adopt]);

    const signInWithApple = useCallback(async () => {
        const gen = generationRef.current;
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
        const adoptedGen = await finishSignIn(await signInWithIdToken('apple', credential.identityToken, nonce.raw), gen);
        if (adoptedGen === null || generationRef.current !== adoptedGen) return;
        captureEvent('sign_in_completed', { method: 'apple' });
    }, [finishSignIn]);

    const signInWithOAuth = useCallback(
        async (provider: OAuthProvider) => {
            const gen = generationRef.current;
            const pkce = await createPkce();
            const result = await WebBrowser.openAuthSessionAsync(
                authorizeUrl(provider, pkce.challenge),
                AUTH_REDIRECT_URL,
            );
            if (result.type !== 'success') return;
            const code = new URL(result.url).searchParams.get('code');
            if (!code) throw new Error('oauth_no_code');
            const adoptedGen = await finishSignIn(await exchangeAuthCode(code, pkce.verifier), gen);
            if (adoptedGen === null || generationRef.current !== adoptedGen) return;
            captureEvent('sign_in_completed', { method: provider });
        },
        [finishSignIn],
    );

    const signInWithEmail = useCallback(
        async (email: string, password: string, captchaToken: string) => {
            const gen = generationRef.current;
            const adoptedGen = await finishSignIn(await signInWithPassword(email, password, captchaToken), gen);
            if (adoptedGen === null || generationRef.current !== adoptedGen) return;
            captureEvent('sign_in_completed', { method: 'email' });
        },
        [finishSignIn],
    );

    const signUpWithEmail = useCallback(
        async (email: string, password: string, captchaToken: string) => {
            const gen = generationRef.current;
            const session = await signUpWithPassword(email, password, captchaToken);
            if (generationRef.current !== gen) return true;
            if (!session) return false;
            const adoptedGen = await finishSignIn(session, gen);
            if (adoptedGen === null || generationRef.current !== adoptedGen) return true;
            captureEvent('sign_in_completed', { method: 'email' });
            return true;
        },
        [finishSignIn],
    );

    const signInWithPasskey = useCallback(async (captchaToken: string): Promise<boolean> => {
        const gen = generationRef.current;
        if (!passkeyGate()) return false;
        const { challengeId, options } = validatePasskeyOptions(await passkeySignInOptions(captchaToken), false);
        const credential = await getCredential(options);
        if (credential === null) return false;
        const adoptedGen = await finishSignIn(await passkeySignInVerify(challengeId, toGoTrueCredential(credential)), gen);
        if (adoptedGen === null || generationRef.current !== adoptedGen) return false;
        captureEvent('sign_in_completed', { method: 'passkey' });
        return true;
    }, [finishSignIn]);

    const signOut = useCallback(async (expected?: number) => {
        if (expected !== undefined && expected !== generationRef.current) return;
        const token = sessionRef.current?.accessToken;
        await drop();
        if (token) await revokeSession(token);
    }, [drop]);

    const value = useMemo<AuthContextValue>(
        () => ({ status, generation, sessionGeneration, beginSessionTask, canReloadSession, api, onSessionLost, getAccessToken, adoptSession, appleNativeAvailable, signInWithApple, signInWithOAuth, signInWithEmail, signUpWithEmail, signInWithPasskey, signOut }),
        [status, generation, sessionGeneration, beginSessionTask, canReloadSession, api, onSessionLost, getAccessToken, adoptSession, appleNativeAvailable, signInWithApple, signInWithOAuth, signInWithEmail, signUpWithEmail, signInWithPasskey, signOut],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
