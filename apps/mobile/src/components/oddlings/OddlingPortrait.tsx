import { rawText } from '../../lib/i18n/translate';
import { Text as StatusText } from '../ui/Text';
import { Image } from 'expo-image';
import { useIsFocused } from 'expo-router';
import { Skia } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { puppetRig } from '../../../../../app/veyrnox/_lib/oddlingPuppetRigs.js';
import { MIN_TARGET } from '../../lib/a11y';
import { t } from '../../lib/i18n';
import { portraitUrl } from '../../lib/oddlings';
import { portraitBytesFor } from '../../lib/oddlingsPortraitFile';
import { prepareNativePuppet, validatePuppetShader, type PuppetLayers } from '../../lib/oddlings/puppetNative';
import { checkPuppetAbort, yieldPuppetTask } from '../../lib/oddlings/puppetPrepare';
import { PORTRAIT_FIT, puppetUniforms } from '../../lib/oddlings/puppetSksl';
import { colors } from '../../theme';
import { OddlingPuppetCanvas, PuppetBoundary } from './OddlingPuppetCanvas';

type Phase = 'idle' | 'preparing' | 'ready' | 'failed' | 'offline';

// Key the entire session so a character change cancels work, releases images and resets Play/Pause.
export function OddlingPortrait(props: { id: string; name: string }) {
    return <PortraitSession key={props.id} {...props} />;
}
function PortraitSession({ id, name }: { id: string; name: string }) {
    const focused = useIsFocused();
    const rig = useMemo(() => puppetRig(id), [id]);
    const [reduce, setReduce] = useState<boolean | null>(null);
    const [wanted, setWanted] = useState<boolean | null>(null);
    const [active, setActive] = useState(AppState.currentState === 'active');
    const [phase, setPhase] = useState<Phase>('idle');
    const [layers, setLayers] = useState<PuppetLayers | null>(null);
    const [viewSize, setViewSize] = useState([0, 0]);
    const [attempt, setAttempt] = useState(0);
    const wantsPlay = wanted ?? (reduce === false);
    // Once requested, preparation survives pauses. Reduce motion alone never starts it.
    const requested = reduce !== null && (wantsPlay || wanted !== null);
    const playing = wantsPlay && active && focused;

    useEffect(() => {
        let live = true;
        AccessibilityInfo.isReduceMotionEnabled().then(on => live && setReduce(on), () => live && setReduce(false));
        const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', on => live && setReduce(on));
        return () => { live = false; sub.remove(); };
    }, []);
    useEffect(() => {
        const sub = AppState.addEventListener('change', state => setActive(state === 'active'));
        return () => sub.remove();
    }, []);
    useEffect(() => {
        if (!requested) { setLayers(null); setPhase('idle'); return; }
        const controller = new AbortController();
        const { signal } = controller;
        let owned: PuppetLayers | null = null;
        setLayers(null);
        setPhase('preparing');
        const prepare = async () => {
            let bytes: Uint8Array | null;
            try { bytes = await portraitBytesFor(id); }
            catch { if (!signal.aborted) setPhase('offline'); return; }
            try {
                // Give the preparing state a frame before decode, mask work and row batches.
                await yieldPuppetTask();
                checkPuppetAbort(signal);
                if (!bytes || !rig) throw new Error('puppet_portrait_invalid');
                owned = await prepareNativePuppet(Skia, bytes, rig, signal);
                if (signal.aborted) { owned.dispose(); return; }
                // Probe binding at the intrinsic portrait size before exposing the Canvas.
                validatePuppetShader(Skia, owned, puppetUniforms(rig, owned.lids, id, 0, [1024, 1536]));
                setLayers(owned);
                setPhase('ready');
            } catch { owned?.dispose(); owned = null; if (!signal.aborted) setPhase('failed'); }
        };
        let timer: ReturnType<typeof setTimeout> | undefined;
        const frame = requestAnimationFrame(() => { timer = setTimeout(() => { void prepare(); }, 0); });
        return () => { controller.abort(); cancelAnimationFrame(frame); clearTimeout(timer); owned?.dispose(); };
    }, [requested, id, rig, attempt]);

    const label = playing ? t('oddlings.puppet.pause') : t('oddlings.puppet.play');
    return (
        <View>
            <View style={styles.frame} onLayout={event => {
                const { width, height } = event.nativeEvent.layout;
                setViewSize(previous => previous[0] === width && previous[1] === height ? previous : [width, height]);
            }}>
                <Image source={{ uri: portraitUrl(id) }} style={StyleSheet.absoluteFill} contentFit={PORTRAIT_FIT} cachePolicy="disk" accessibilityLabel={rawText(t('oddlings.portrait', { name }))} accessibilityIgnoresInvertColors />
                {requested && phase === 'ready' && layers && rig && viewSize.every(v => v > 0) ? (
                    <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                        <PuppetBoundary onFailure={() => setPhase('failed')}>
                            <OddlingPuppetCanvas id={id} rig={rig} layers={layers} playing={playing} viewSize={viewSize} />
                        </PuppetBoundary>
                    </View>
                ) : null}
            </View>
            {reduce === null || phase === 'failed' ? null : (
                <Pressable accessibilityRole="button" accessibilityLabel={rawText(label)} style={styles.toggle} onPress={() => {
                    if (phase === 'offline') setAttempt(value => value + 1);
                    setWanted(!playing);
                }}>
                    <Text style={styles.toggleText}>{phase === 'preparing' ? t('oddlings.puppet.preparing') : label}</Text>
                </Pressable>
            )}
            {phase === 'failed' ? <StatusText variant="inherit" style={styles.problem} accessibilityLiveRegion="polite">{t('oddlings.puppet.failed')}</StatusText> : null}
            {phase === 'offline' ? <StatusText variant="inherit" style={styles.problem} accessibilityLiveRegion="polite">{t('oddlings.puppet.offline')}</StatusText> : null}
        </View>
    );
}
const styles = StyleSheet.create({
    frame: { width: '100%', aspectRatio: 2 / 3, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface },
    toggle: { minHeight: MIN_TARGET, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
    toggleText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
    problem: { color: colors.muted, fontSize: 13, marginTop: 8 },
});
