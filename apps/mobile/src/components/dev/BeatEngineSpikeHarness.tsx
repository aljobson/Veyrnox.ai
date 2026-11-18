import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import {
    appendEvent,
    B1_PLAY_SECONDS,
    buildReport,
    FROZEN_AFTER_MS,
    judge,
    median,
    parsePageMessage,
    softwareMs,
    SPIKE_BASE_URL,
    type LogEvent,
    type PadSample,
} from '../../lib/beatEngineSpike';
import { BEAT_SPIKE_HTML } from '../../lib/beatEngineSpikeHtml';

// Spike B1 harness. Dev-only: the route that mounts this refuses to render without EXPO_PUBLIC_DEV_B1_BEAT_SPIKE=1.
// English strings on purpose; it ships to nobody. Pure react-native + react-native-webview on purpose, so it can run
// in any build that has the webview native module.
const palette = { bg: '#0b0b10', text: '#f2f2f8', muted: '#9a9aae', border: '#3a3a4c', accent: '#8b6bff' };

export function BeatEngineSpikeHarness({ deviceLabel }: { readonly deviceLabel: string }) {
    const web = useRef<WebView<unknown>>(null);
    const [log, setLog] = useState<readonly LogEvent[]>([]);
    const [pads, setPads] = useState<readonly PadSample[]>([]);
    const [seconds, setSeconds] = useState(0);
    const [maxSeconds, setMaxSeconds] = useState(0);
    const [heap, setHeap] = useState<number | null>(null);
    const [peakHeap, setPeakHeap] = useState<number | null>(null);
    const [tracks, setTracks] = useState(0);
    const [ctxState, setCtxState] = useState('none');
    const [kills, setKills] = useState(0);
    const [backgroundOk, setBackgroundOk] = useState<boolean | null>(null);
    const [caps, setCaps] = useState<unknown>(null);
    const [showLog, setShowLog] = useState(false);
    const [frozen, setFrozen] = useState(false);
    const lastBeat = useRef<number | null>(null);
    const bgAt = useRef<{ at: number; audio: number } | null>(null);
    const lastAudio = useRef(0);

    const note = useCallback((kind: string, detail?: string) => setLog((p) => appendEvent(p, { at: Date.now(), kind, detail })), []);

    useEffect(() => {
        const sub = AppState.addEventListener('change', (state) => {
            if (state === 'background' || state === 'inactive') {
                note(state);
                if (state === 'background') bgAt.current = { at: Date.now(), audio: lastAudio.current };
            } else {
                note('foreground');
            }
        });
        return () => sub.remove();
    }, [note]);

    useEffect(() => {
        const id = setInterval(() => {
            if (AppState.currentState !== 'active' || lastBeat.current === null) return;
            const stale = Date.now() - lastBeat.current > FROZEN_AFTER_MS;
            setFrozen((was) => {
                if (stale && !was) note('frozen', 'no heartbeat');
                return stale;
            });
        }, 2000);
        return () => clearInterval(id);
    }, [note]);

    const onMessage = useCallback(
        (event: WebViewMessageEvent) => {
            const m = parsePageMessage(event.nativeEvent.data);
            if (!m) return;
            switch (m.type) {
                case 'pad':
                    setPads((p) => [...p, { source: m.source, jsMs: m.jsMs, graphMs: m.graphMs, baseMs: m.baseMs, outMs: m.outMs, bridgeMs: m.nativeToPageMs }].slice(-40));
                    note('pad', `${m.source} js ${m.jsMs} graph ${m.graphMs} base ${m.baseMs} out ${m.outMs} bridge ${m.nativeToPageMs}`);
                    break;
                case 'beat':
                    lastBeat.current = Date.now();
                    lastAudio.current = m.audioTime;
                    setFrozen(false);
                    setSeconds(m.seconds);
                    setMaxSeconds((s) => Math.max(s, m.seconds));
                    setTracks(m.tracks);
                    setHeap(m.heapMb);
                    if (m.heapMb !== null) setPeakHeap((p) => Math.max(p ?? 0, m.heapMb!));
                    setCtxState(m.state);
                    if (m.seconds % 30 === 0) note('beat', `${m.seconds}s tracks ${m.tracks} notes ${m.notes} ctx ${m.state} audio ${m.audioTime} stalls ${m.stalls} heap ${m.heapMb}`);
                    break;
                case 'visibility': {
                    note('page-visibility', `hidden ${m.hidden} ctx ${m.ctx} audio ${m.audioTime}`);
                    break;
                }
                case 'ctxstate':
                    setCtxState(m.state);
                    note('ctx', m.state);
                    break;
                case 'caps':
                    setCaps(m);
                    note('caps', JSON.stringify(m).slice(0, 300));
                    break;
                case 'mic':
                    note('mic', m.ok ? 'granted' : `blocked ${m.name}`);
                    break;
                default:
                    note(m.type, 'text' in m ? m.text : 'message' in m ? m.message : undefined);
            }
            // After a background period, a running context whose audio clock moved on counts as survival.
            if (m.type === 'beat' && bgAt.current && Date.now() - bgAt.current.at > 5_000 && AppState.currentState === 'active') {
                setBackgroundOk(m.state === 'running' && m.audioTime > bgAt.current.audio + 1);
                note('background-check', `ctx ${m.state}, audio clock ${bgAt.current.audio} -> ${m.audioTime}`);
                bgAt.current = null;
            }
        },
        [note],
    );

    const verdict = useMemo(() => judge({ pads, maxSeconds, kills, backgroundOk }), [pads, maxSeconds, kills, backgroundOk]);
    const webMedian = median(pads.filter((p) => p.source === 'web').map(softwareMs));
    const nativeMedian = median(pads.filter((p) => p.source === 'native').map(softwareMs));
    const run = (js: string) => web.current?.injectJavaScript(`${js};true;`);
    const share = () => Share.share({ message: buildReport({ device: deviceLabel, verdict, pads, peakHeapMb: peakHeap, log, caps }) });

    return (
        <View style={s.root}>
            <View style={s.bar}>
                <Text style={s.status}>
                    {`tracks ${tracks} | ${seconds}/${B1_PLAY_SECONDS}s | ctx ${ctxState} | heap ${heap ?? 'n/a'} MB (peak ${peakHeap ?? 'n/a'}) | kills ${kills}${frozen ? ' | FROZEN' : ''}`}
                </Text>
                <Text style={s.status}>
                    {`pad web ${webMedian === null ? 'n/a' : webMedian.toFixed(1)} ms | pad native ${nativeMedian === null ? 'n/a' : nativeMedian.toFixed(1)} ms | hits ${pads.length} | bg ${backgroundOk === null ? 'not tried' : backgroundOk ? 'ok' : 'FAIL'} | verdict pad ${verdict.padPass === null ? '?' : verdict.padPass ? 'PASS' : 'FAIL'} run ${verdict.playPass ? 'PASS' : 'not yet'}`}
                </Text>
                <View style={s.row}>
                    <Pressable accessibilityRole="button" style={s.nativePad} onPressIn={() => run(`window.__b1&&window.__b1.hit(${Date.now()})`)}>
                        <Text style={s.btnText}>NATIVE PAD</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" style={s.btn} onPress={() => setShowLog((v) => !v)}>
                        <Text style={s.btnText}>{showLog ? 'Hide log' : 'Log'}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" style={s.btn} onPress={() => void share()}>
                        <Text style={s.btnText}>Share</Text>
                    </Pressable>
                </View>
            </View>
            {showLog ? (
                <ScrollView style={s.log}>
                    {log.map((e, i) => (
                        <Text key={`${e.at}-${i}`} style={s.small}>{`${new Date(e.at).toISOString().slice(14, 23)} ${e.kind}${e.detail ? ` ${e.detail}` : ''}`}</Text>
                    ))}
                </ScrollView>
            ) : null}
            <WebView
                ref={web}
                source={{ html: BEAT_SPIKE_HTML, baseUrl: SPIKE_BASE_URL }}
                originWhitelist={['about:*', 'https://beat-spike.invalid*']}
                onShouldStartLoadWithRequest={(req) => req.url.startsWith('about:') || req.url.startsWith(SPIKE_BASE_URL)}
                onMessage={onMessage}
                javaScriptEnabled
                domStorageEnabled
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                allowFileAccess={false}
                setSupportMultipleWindows={false}
                onContentProcessDidTerminate={() => {
                    setKills((k) => k + 1);
                    note('terminated', 'iOS content process terminated');
                    web.current?.reload();
                }}
                onRenderProcessGone={(e) => {
                    setKills((k) => k + 1);
                    note('terminated', `Android render process gone${e.nativeEvent.didCrash ? ' (crash)' : ''}`);
                }}
                onError={(e) => note('error', `load error ${e.nativeEvent.description}`.slice(0, 160))}
                style={s.web}
            />
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: palette.bg },
    bar: { padding: 8, gap: 6, borderBottomWidth: 1, borderBottomColor: palette.border },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    status: { color: palette.text, fontSize: 11 },
    small: { color: palette.muted, fontSize: 10 },
    btn: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: palette.border },
    nativePad: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 8, backgroundColor: palette.accent },
    btnText: { color: palette.text, fontSize: 13, fontWeight: '600' },
    log: { maxHeight: 180, padding: 8, backgroundColor: '#15151d' },
    web: { flex: 1, backgroundColor: palette.bg },
});
