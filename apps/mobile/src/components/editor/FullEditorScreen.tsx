import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useAuth } from '../../auth/AuthProvider';
import { HeaderAction } from '../HeaderAction';
import { touchTarget } from '../../lib/a11y';
import { config } from '../../lib/config';
import {
    allowHostedEditorNavigation,
    buildSessionSeed,
    hostedEditorUrl,
    HOSTED_EDITOR_INJECTION,
    MIN_EDITOR_TOKEN_SECONDS,
    parseHostedEditorMessage,
    seedSecondsLeft,
    sessionInjection,
} from '../../lib/hostedEditor';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

type Problem = 'session' | 'load' | 'memory';

export function FullEditorScreen({ projectId }: { projectId: string }) {
    const { getAccessToken } = useAuth();
    const router = useRouter();
    const web = useRef<WebView<unknown>>(null);
    const alive = useRef(true);
    const processRestarts = useRef(0);
    const loadGeneration = useRef(0);
    const [seedScript, setSeedScript] = useState<string | null>(null);
    const [problem, setProblem] = useState<Problem | null>(null);
    const [loading, setLoading] = useState(true);
    const [reloadKey, setReloadKey] = useState(0);

    const prepare = useCallback(async (resetProcessRestarts: boolean) => {
        const generation = ++loadGeneration.current;
        if (resetProcessRestarts) processRestarts.current = 0;
        setProblem(null);
        setLoading(true);
        setSeedScript(null);
        try {
            const token = await getAccessToken(true);
            if (!alive.current || generation !== loadGeneration.current) return;
            const seed = token ? buildSessionSeed(token) : null;
            if (!seed || seedSecondsLeft(seed, Date.now()) < MIN_EDITOR_TOKEN_SECONDS) {
                setProblem('session');
                setLoading(false);
                return;
            }
            setSeedScript(sessionInjection(seed, new URL(config.apiBase).origin));
            setReloadKey((value) => value + 1);
        } catch {
            if (alive.current && generation === loadGeneration.current) {
                setProblem('session');
                setLoading(false);
            }
        }
    }, [getAccessToken]);

    useEffect(() => {
        alive.current = true;
        const timer = setTimeout(() => void prepare(true), 0);
        return () => {
            clearTimeout(timer);
            loadGeneration.current += 1;
            alive.current = false;
        };
    }, [prepare, projectId]);

    const retry = useCallback(() => void prepare(true), [prepare]);
    const processStopped = useCallback(() => {
        if (processRestarts.current >= 1) {
            setProblem('memory');
            setLoading(false);
            return;
        }
        processRestarts.current += 1;
        void prepare(false);
    }, [prepare]);
    const onMessage = useCallback((event: WebViewMessageEvent) => {
        const message = parseHostedEditorMessage(event.nativeEvent.data);
        if (!message) return;
        if (message.type === 'ready') setLoading(false);
        if (message.type === 'open-credits') router.push('/credits');
        if (message.type === 'error') setProblem('load');
    }, [router]);

    const problemCopy = problem === 'session'
        ? t('editor.fullSession')
        : problem === 'memory'
            ? t('editor.fullMemory')
            : t('editor.fullFailed');

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('editor.title'), headerRight: () => <HeaderAction label={t('editor.reload')} onPress={retry} /> }} />
            {seedScript && !problem ? (
                <WebView
                    key={reloadKey}
                    ref={web}
                    source={{ uri: hostedEditorUrl(config.apiBase, projectId) }}
                    originWhitelist={[new URL(config.apiBase).origin, 'blob:*', 'about:*']}
                    onShouldStartLoadWithRequest={(request) => allowHostedEditorNavigation(request.url, config.apiBase)}
                    injectedJavaScriptBeforeContentLoaded={seedScript}
                    injectedJavaScriptBeforeContentLoadedForMainFrameOnly
                    injectedJavaScript={HOSTED_EDITOR_INJECTION}
                    injectedJavaScriptForMainFrameOnly
                    onMessage={onMessage}
                    onLoadStart={() => setLoading(true)}
                    onError={() => { setProblem('load'); setLoading(false); }}
                    onHttpError={() => { setProblem('load'); setLoading(false); }}
                    onContentProcessDidTerminate={processStopped}
                    onRenderProcessGone={processStopped}
                    javaScriptEnabled
                    domStorageEnabled
                    incognito
                    allowsInlineMediaPlayback
                    mediaPlaybackRequiresUserAction={false}
                    allowsFullscreenVideo
                    allowFileAccess={false}
                    setSupportMultipleWindows={false}
                    javaScriptCanOpenWindowsAutomatically={false}
                    style={styles.web}
                />
            ) : null}
            {loading && !problem ? (
                <View style={styles.overlay} accessibilityLiveRegion="polite">
                    <ActivityIndicator color={colors.accent} />
                    <Text style={styles.body}>{t('editor.fullLoading')}</Text>
                </View>
            ) : null}
            {problem ? (
                <View style={styles.center} accessibilityLiveRegion="assertive">
                    <Text accessibilityRole="header" style={styles.title}>{t('editor.fullUnavailable')}</Text>
                    <Text style={styles.body}>{problemCopy}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('editor.retryNow')} style={[styles.retry, touchTarget]} onPress={retry}>
                        <Text style={styles.retryText}>{t('editor.retryNow')}</Text>
                    </Pressable>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    web: { flex: 1, backgroundColor: colors.background },
    overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, backgroundColor: colors.background },
    title: { color: colors.text, fontSize: 20, fontWeight: '700', textAlign: 'center' },
    body: { color: colors.body, fontSize: 15, lineHeight: 22, textAlign: 'center' },
    retry: { minWidth: 120, alignItems: 'center', paddingHorizontal: 18, borderRadius: 12, backgroundColor: colors.accent },
    retryText: { color: colors.accentInk, fontSize: 16, fontWeight: '600' },
});
