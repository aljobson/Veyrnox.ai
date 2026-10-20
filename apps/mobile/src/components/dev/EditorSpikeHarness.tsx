import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Device from 'expo-device';
import { useAuth } from '../../auth/AuthProvider';
import { APP_ENV, config } from '../../lib/config';
import {
    allowSpikeNavigation,
    appendEvent,
    buildReport,
    buildSessionSeed,
    checkFrozen,
    describeMessage,
    editorUrl,
    emptyTracker,
    exportRuns,
    INSTRUMENTATION,
    judge,
    parsePageMessage,
    seedSecondsLeft,
    sessionInjection,
    trackMessage,
    type LogEvent,
    type LogKind,
    type Tracker,
} from '../../lib/editorSpike';
import { colors } from '../../theme';

// Spike S1 harness (docs/mobile/spikes/S1-editor-export.md). Dev-only: the route that mounts this refuses to render
// unless the build was made with EXPO_PUBLIC_DEV_S1_EDITOR_SPIKE=1. Strings are English on purpose; it ships to nobody.
const MIN_TOKEN_SECONDS = 20 * 60;
const TICK_MS = 2_000;

export function EditorSpikeHarness() {
    const { getAccessToken } = useAuth();
    // WebView<unknown>: the default type parameter is `undefined`, which makes every prop `never` when a ref is attached.
    const web = useRef<WebView<unknown>>(null);
    const [seedScript, setSeedScript] = useState<string | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [log, setLog] = useState<readonly LogEvent[]>([]);
    const [tracker, setTracker] = useState<Tracker>(emptyTracker);
    const [timeline, setTimeline] = useState('60');
    const [progress, setProgress] = useState<number | null>(null);
    const [showLog, setShowLog] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const trackerRef = useRef(tracker);
    trackerRef.current = tracker;

    const note = useCallback((kind: LogKind, detail?: string) => {
        setLog((prev) => appendEvent(prev, { at: Date.now(), kind, detail }));
    }, []);

    // The token is fetched fresh, checked for life left, and handed to the page by script, never in a URL.
    useEffect(() => {
        let alive = true;
        void (async () => {
            try {
                const token = await getAccessToken(true);
                if (!alive) return;
                const seed = token ? buildSessionSeed(token) : null;
                if (!seed) return setProblem('No usable session. Sign in again, then reopen this screen.');
                const left = seedSecondsLeft(seed, Date.now());
                if (left < MIN_TOKEN_SECONDS) return setProblem(`The session has only ${Math.floor(left / 60)} min left. Reopen to refresh it.`);
                setSeedScript(sessionInjection(seed, new URL(config.apiBase).origin));
                note('note', `session handed in, ${Math.floor(left / 60)} min left, ${Platform.OS} ${Platform.Version}`);
            } catch {
                if (alive) setProblem('Could not read the session.');
            }
        })();
        return () => {
            alive = false;
        };
    }, [getAccessToken, note, reloadKey]);

    useEffect(() => {
        const sub = AppState.addEventListener('change', (state) => {
            if (state === 'background') note('background');
            else if (state === 'active') note('foreground');
        });
        return () => sub.remove();
    }, [note]);

    // A page that stops beating while the app is in front is frozen, which is different from a kill.
    useEffect(() => {
        const id = setInterval(() => {
            if (AppState.currentState !== 'active') return;
            const { tracker: next, justFroze } = checkFrozen(trackerRef.current, Date.now());
            if (justFroze) {
                setTracker(next);
                note('frozen', `no heartbeat for ${Math.round((Date.now() - (trackerRef.current.lastBeatAt ?? 0)) / 1000)} s`);
            }
        }, TICK_MS);
        return () => clearInterval(id);
    }, [note]);

    const onMessage = useCallback(
        (event: WebViewMessageEvent) => {
            const message = parsePageMessage(event.nativeEvent.data);
            if (!message) return;
            const now = Date.now();
            setTracker((prev) => {
                const next = trackMessage(prev, message, now);
                if (prev.frozenSince !== null && next.frozenSince === null) note('note', 'heartbeat is back');
                return next;
            });
            if (message.type === 'progress') return setProgress(message.value);
            if (message.type === 'export-end') setProgress(null);
            const described = describeMessage(message);
            if (described) note(described.kind, described.detail);
        },
        [note],
    );

    const reload = useCallback(() => {
        setSeedScript(null);
        setProblem(null);
        setTracker(emptyTracker);
        setReloadKey((k) => k + 1);
        note('note', 'reload requested');
    }, [note]);

    const seconds = Number.parseFloat(timeline);
    const timelineSeconds = Number.isFinite(seconds) ? seconds : 0;
    const verdict = useMemo(() => judge(log, timelineSeconds), [log, timelineSeconds]);
    const runs = useMemo(() => exportRuns(log), [log]);

    const share = useCallback(async () => {
        const text = buildReport({
            log,
            timelineSeconds,
            device: `${Device.modelName ?? 'unknown'} ${Platform.OS} ${Platform.Version}`,
            appEnv: APP_ENV,
            peakHeapMb: trackerRef.current.peakHeapMb,
            now: Date.now(),
        });
        await Share.share({ message: text });
    }, [log, timelineSeconds]);

    if (problem) {
        return (
            <View style={styles.center}>
                <Text style={styles.body}>{problem}</Text>
                <Pressable accessibilityRole="button" style={styles.button} onPress={reload}>
                    <Text style={styles.buttonText}>Try again</Text>
                </Pressable>
            </View>
        );
    }
    if (!seedScript) {
        return (
            <View style={styles.center}>
                <ActivityIndicator color={colors.accent} />
            </View>
        );
    }

    return (
        <View style={styles.root}>
            <View style={styles.bar}>
                <Text style={styles.status} numberOfLines={2}>
                    {`exports ${runs.length} | kills ${verdict.killCount} | ratio ${verdict.ratio === null ? 'n/a' : verdict.ratio.toFixed(2)}x | ${verdict.pass ? 'PASS' : 'not yet'}${progress === null ? '' : ` | ${Math.round(progress * 100)}%`}${tracker.frozenSince === null ? '' : ' | FROZEN'}`}
                </Text>
                <View style={styles.row}>
                    <TextInput
                        accessibilityLabel="Timeline length in seconds"
                        style={styles.input}
                        value={timeline}
                        onChangeText={setTimeline}
                        keyboardType="decimal-pad"
                    />
                    <Text style={styles.small}>s timeline</Text>
                    <Pressable accessibilityRole="button" style={styles.button} onPress={reload}>
                        <Text style={styles.buttonText}>Reload</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" style={styles.button} onPress={() => setShowLog((v) => !v)}>
                        <Text style={styles.buttonText}>{showLog ? 'Hide log' : 'Log'}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" style={styles.button} onPress={() => void share()}>
                        <Text style={styles.buttonText}>Share</Text>
                    </Pressable>
                </View>
            </View>
            {showLog ? (
                <ScrollView style={styles.log}>
                    {log.map((e, i) => (
                        <Text key={`${e.at}-${i}`} style={styles.small}>
                            {`${new Date(e.at).toISOString().slice(14, 23)} ${e.kind}${e.detail ? ` ${e.detail}` : ''}`}
                        </Text>
                    ))}
                </ScrollView>
            ) : null}
            <WebView
                key={reloadKey}
                ref={web}
                source={{ uri: editorUrl(config.apiBase) }}
                originWhitelist={[`${new URL(config.apiBase).origin}`, 'blob:*', 'about:*']}
                onShouldStartLoadWithRequest={(req) => allowSpikeNavigation(req.url, config.apiBase)}
                injectedJavaScriptBeforeContentLoaded={seedScript}
                injectedJavaScriptBeforeContentLoadedForMainFrameOnly
                injectedJavaScript={INSTRUMENTATION}
                injectedJavaScriptForMainFrameOnly
                onMessage={onMessage}
                // The editor plays video and writes a blob, and its import button is a file input (iOS shows the photo picker).
                javaScriptEnabled
                domStorageEnabled
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                allowsFullscreenVideo
                allowFileAccess={false}
                setSupportMultipleWindows={false}
                // iOS: the web content process was killed (usually memory). Android: the render process went away.
                onContentProcessDidTerminate={() => {
                    note('terminated', 'iOS content process terminated');
                    web.current?.reload();
                }}
                onRenderProcessGone={(e) => note('terminated', `Android render process gone${e.nativeEvent.didCrash ? ' (crash)' : ' (killed)'}`)}
                // iOS only. A blob: download link is unlikely to reach this; logging it tells the owner whether the Download link did anything.
                onFileDownload={() => note('note', 'web view asked the app to handle a file download')}
                onLoadStart={() => note('page', 'load start')}
                onError={(e) => note('error', `load error ${e.nativeEvent.description}`.slice(0, 160))}
                onHttpError={(e) => note('error', `http ${e.nativeEvent.statusCode}`)}
                style={styles.web}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16, backgroundColor: colors.background },
    bar: { padding: 8, gap: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    status: { color: colors.text, fontSize: 12 },
    small: { color: colors.muted, fontSize: 11 },
    body: { color: colors.body, fontSize: 15, textAlign: 'center' },
    input: { minHeight: 44, minWidth: 56, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 8, paddingHorizontal: 8, color: colors.text },
    button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.borderStrong },
    buttonText: { color: colors.text, fontSize: 13 },
    log: { maxHeight: 160, padding: 8, backgroundColor: colors.surface },
    web: { flex: 1, backgroundColor: colors.background },
});
