import { Image } from 'expo-image';
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentType, type Ref } from 'react';
import { AccessibilityInfo, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { MIN_TARGET } from '../../lib/a11y';
import { t } from '../../lib/i18n';
import { portraitUrl } from '../../lib/oddlings';
import { portraitDataUriFor } from '../../lib/oddlingsPortraitFile';
import { PUPPET_BACKGROUND, puppetEvent, puppetHtml, puppetPlaying, puppetStart } from '../../lib/oddlingsPuppet';
import { colors } from '../../theme';

// The package's class typing rejects a ref under React 19's types; the one method used is declared here.
interface Injectable { injectJavaScript(script: string): void }
const Web = WebView as unknown as ComponentType<ComponentProps<typeof WebView> & { ref?: Ref<Injectable> }>;

type Phase = 'idle' | 'preparing' | 'ready' | 'failed' | 'offline';

// The portrait with the web's moving preview on top. Still pictures stay under it, so a failure or a person who asked
// for less motion never sees an empty box. With "reduce motion" on, nothing moves until the person presses Play.
// The preview makes no sound, calls no model and costs nothing.
export function OddlingPortrait({ id, name }: { id: string; name: string }) {
    const ref = useRef<Injectable | null>(null);
    const loaded = useRef(false);
    const html = useMemo(() => puppetHtml(), []);
    const focused = useIsFocused();
    const [reduce, setReduce] = useState<boolean | null>(null);
    const [wanted, setWanted] = useState<boolean | null>(null); // the person's own Play or Pause
    const [active, setActive] = useState(true); // the app is in front
    const [phase, setPhase] = useState<Phase>('idle');
    const [data, setData] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        AccessibilityInfo.isReduceMotionEnabled().then((on) => live && setReduce(on), () => live && setReduce(false));
        const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => live && setReduce(on));
        return () => { live = false; sub.remove(); };
    }, []);

    useEffect(() => {
        const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
        return () => sub.remove();
    }, []);

    // Plays by itself unless the phone asks for less motion; a press always wins.
    const wantsPlay = wanted ?? (reduce === false);
    const mount = reduce !== null && (wantsPlay || wanted !== null) && phase !== 'failed';
    const playing = wantsPlay && active && focused;

    const prepare = useCallback(async () => {
        setPhase('preparing');
        try {
            const uri = await portraitDataUriFor(id);
            if (!uri) return setPhase('failed');
            setData(uri);
        } catch {
            setPhase('offline');
        }
    }, [id]);

    useEffect(() => {
        if (mount && data === null && phase === 'idle') void prepare();
    }, [mount, data, phase, prepare]);

    const start = useCallback(() => {
        if (!data || !loaded.current) return;
        const call = puppetStart(id, data, playing);
        if (call) ref.current?.injectJavaScript(call);
    }, [data, id, playing]);
    const startRef = useRef(start);
    startRef.current = start;

    useEffect(() => { start(); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps -- a new picture restarts; play changes below only toggle
    useEffect(() => {
        if (phase === 'ready') ref.current?.injectJavaScript(puppetPlaying(playing));
    }, [playing, phase]);

    const label = playing ? t('oddlings.puppet.pause') : t('oddlings.puppet.play');
    return (
        <View>
            <View style={styles.frame}>
                <Image source={{ uri: portraitUrl(id) }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" accessibilityLabel={t('oddlings.portrait', { name })} accessibilityIgnoresInvertColors />
                {mount && data ? (
                    <View style={[StyleSheet.absoluteFill, phase === 'ready' ? null : styles.hidden]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                        <Web
                            ref={ref}
                            source={{ html }}
                            originWhitelist={['about:*']}
                            onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
                            javaScriptEnabled
                            scrollEnabled={false}
                            bounces={false}
                            overScrollMode="never"
                            setSupportMultipleWindows={false}
                            allowsLinkPreview={false}
                            mediaPlaybackRequiresUserAction
                            style={styles.web}
                            onLoadEnd={() => { loaded.current = true; startRef.current(); }}
                            onMessage={(e) => {
                                const event = puppetEvent(e.nativeEvent.data);
                                if (event === 'ready') setPhase('ready');
                                if (event === 'failed') setPhase('failed');
                            }}
                        />
                    </View>
                ) : null}
            </View>
            {reduce === null || phase === 'failed' ? null : (
                <Pressable accessibilityRole="button" accessibilityLabel={label} style={styles.toggle} onPress={() => { if (phase === 'offline') setPhase('idle'); setWanted(!playing); }}>
                    <Text style={styles.toggleText}>{phase === 'preparing' ? t('oddlings.puppet.preparing') : label}</Text>
                </Pressable>
            )}
            {phase === 'failed' ? <Text style={styles.problem} accessibilityLiveRegion="polite">{t('oddlings.puppet.failed')}</Text> : null}
            {phase === 'offline' ? <Text style={styles.problem} accessibilityLiveRegion="polite">{t('oddlings.puppet.offline')}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    frame: { width: '100%', aspectRatio: 2 / 3, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface },
    hidden: { opacity: 0 },
    web: { flex: 1, backgroundColor: PUPPET_BACKGROUND },
    toggle: { minHeight: MIN_TARGET, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
    toggleText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
    problem: { color: colors.muted, fontSize: 13, marginTop: 8 },
});
