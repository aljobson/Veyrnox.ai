import { Stack as RouteStack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, View, useWindowDimensions } from 'react-native';
import { t } from '../../lib/i18n';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { discardCacheCopy } from '../../lib/cacheFiles';
import { DEFAULT_STACK, history, type Stack } from '../../lib/liveEdit/engine';
import { preparePhoto, extractFrame, validateLocalMedia, type LocalSource } from '../../lib/liveEdit/media';
import { pickLiveMedia, preparePickedPhoto, photoStatus } from '../../lib/liveEdit/pickedPhoto';
import type { PickedAsset } from '../../lib/pickedImage';
import { createInferenceLifecycle } from '../../lib/liveEdit/lifecycle';
import { sameFrame, type Inference } from '../../lib/liveEdit/protocol';
import { saveEffectsToPhotos } from '../../lib/lookExport';
import { ds } from '../../theme';
import { Button, Text } from '../ui';
import { themedStyles, useThemedStyles } from '../ui/AppearanceContext';
import { LookStrip } from '../LookStrip';
import { StrengthSlider } from '../StrengthSlider';
import { EffectPhoto } from './EffectPhoto';
import { EffectControls } from './EffectControls';
import { VisionBridge } from './VisionBridge';
type Status = 'empty' | 'loading' | 'ready' | 'noFace' | 'multiple' | 'noHair' | 'failed' | 'invalid' | 'saved' | 'denied' | 'unsupportedFormat' | 'tooLarge';
export function LiveEditScreen({ owner }: { owner: string }) {
    const styles = useThemedStyles(sheets), timeline = useRef(history());
    const { height: screenHeight } = useWindowDimensions();
    const [stack, setStack] = useState(DEFAULT_STACK), [source, setSource] = useState<LocalSource | null>(null);
    const [inference, setInference] = useState<Inference | null>(null), [status, setStatus] = useState<Status>('empty');
    const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [compare, setCompare] = useState(false);
    const [renderReady, setRenderReady] = useState(false), [retry, setRetry] = useState(0), [foreground, setForeground] = useState(true);
    const [clip, setClip] = useState<{ uri: string; duration: number } | null>(null), [position, setPosition] = useState(0);
    const epoch = useRef(0), controller = useRef(new AbortController()), mounted = useRef(true), sourceRef = useRef<LocalSource | null>(null), locking = useRef(false);
    const lifecycle = useRef(createInferenceLifecycle());
    const inferenceGeneration = lifecycle.current.generation;
    const current = () => mounted.current && !controller.current.signal.aborted && getCacheUser() === owner;
    useEffect(() => {
        mounted.current = true;
        const off = subscribeCacheUser(() => { if (getCacheUser() !== owner) { controller.current.abort(); epoch.current++; setSource(null); setInference(null); discardCacheCopy(sourceRef.current?.uri); sourceRef.current = null; } });
        const sub = AppState.addEventListener('change', state => {
            const action = lifecycle.current.transition(state);
            if (action === 'suspend') { setForeground(false); setInference(null); setRenderReady(false); }
            if (action === 'refresh') { setForeground(true); setStatus('loading'); setRenderReady(false); setRetry(n => n + 1); }
        });
        return () => { mounted.current = false; controller.current.abort(); epoch.current++; off(); sub.remove(); discardCacheCopy(sourceRef.current?.uri); };
    }, [owner]);
    const markDirty = () => {
        setRenderReady(false);
        if (status === 'saved') setStatus(inference?.count === 1 ? inference.hair ? 'ready' : 'noHair' : inference?.count === 2 ? 'multiple' : inference?.count === 0 ? 'noFace' : 'failed');
    };
    const change = (next: Stack) => { timeline.current.set(next); setStack(timeline.current.value); markDirty(); };
    const beginChange = () => timeline.current.begin();
    const endChange = () => { timeline.current.commit(); setStack(timeline.current.value); };
    async function load(uri: string, seconds?: number, asset?: PickedAsset) {
        controller.current.abort(); controller.current = new AbortController();
        lifecycle.current.reset();
        const generation = ++epoch.current;
        setSource(null); setInference(null); setRenderReady(false); setStatus('loading');
        discardCacheCopy(sourceRef.current?.uri); sourceRef.current = null;
        let extracted: string | undefined;
        try {
            extracted = seconds === undefined ? undefined : await extractFrame(uri, seconds, controller.current.signal);
            if (!current() || generation !== epoch.current) return;
            const ids = { sourceId: generation, frameId: 1 };
            const made = asset ? await preparePickedPhoto(asset, ids) : await preparePhoto(extracted ?? uri, ids);
            if (!current() || generation !== epoch.current) { discardCacheCopy(made.uri); return; }
            sourceRef.current = made; setSource(made);
        } catch (error) { if (current() && generation === epoch.current) setStatus(photoStatus(error)); }
        finally { discardCacheCopy(extracted); }
    }
    async function pick() {
        if (locking.current || !current()) return;
        locking.current = true; setBusy(true);
        try {
            const result = await pickLiveMedia();
            if (result.canceled || !result.assets[0]) return;
            if (!current()) { result.assets.forEach(a => discardCacheCopy(a.uri)); return; }
            const asset = result.assets[0];
            if (asset.type === 'video') validateLocalMedia(asset.uri, asset.width, asset.height, asset.duration ?? NaN);
            if (asset.type === 'video' && (asset.fileSize ?? Infinity) > 50 * 1024 * 1024) throw Error('invalid-local-media');
            timeline.current = history(); setStack(DEFAULT_STACK); setCompare(false); setPosition(0);
            setClip(asset.type === 'video' ? { uri: asset.uri, duration: asset.duration! / 1000 } : null);
            await load(asset.uri, asset.type === 'video' ? 0 : undefined, asset.type === 'video' ? undefined : asset);
        } catch (error) { if (current()) setStatus(photoStatus(error)); }
        finally { locking.current = false; if (mounted.current) setBusy(false); }
    }
    async function selectFrame() {
        if (!clip || locking.current) return;
        locking.current = true; setBusy(true);
        try { await load(clip.uri, Math.max(0, Math.min(clip.duration - .05, position * clip.duration))); }
        finally { locking.current = false; if (mounted.current) setBusy(false); }
    }
    const receive = (value: Inference) => {
        if (!current() || !sourceRef.current || !sameFrame(value, sourceRef.current) || !lifecycle.current.accept(inferenceGeneration)) return;
        setInference(value); setStatus(value.count === 0 ? 'noFace' : value.count === 2 ? 'multiple' : value.hair ? 'ready' : 'noHair');
    };
    async function save() {
        if (!source || !renderReady || !lifecycle.current.canSave || locking.current || !current()) return;
        locking.current = true; setSaving(true); const generation = epoch.current, lease = lifecycle.current.generation;
        try {
            const saved = await saveEffectsToPhotos(source.uri, stack, inference, source, () => current() && generation === epoch.current && lifecycle.current.owns(lease));
            if (current() && lifecycle.current.owns(lease)) setStatus(saved ? 'saved' : 'denied');
        } catch { if (current() && lifecycle.current.owns(lease)) setStatus('failed'); }
        finally { locking.current = false; if (mounted.current) setSaving(false); }
    }
    const renderError = useCallback(() => { setRenderReady(false); setStatus('failed'); }, []);
    const rendered = useCallback(() => setRenderReady(true), []);
    const messages: Record<Status, string> = { empty: t('liveEdit.intro'), loading: t('liveEdit.loading'), ready: t('liveEdit.ready'), noFace: t('liveEdit.noFace'), multiple: t('liveEdit.multiple'), noHair: t('liveEdit.noHair'), failed: t('liveEdit.failed'), invalid: t('liveEdit.invalid'), unsupportedFormat: t('liveEdit.unsupportedFormat'), tooLarge: t('liveEdit.tooLarge'), saved: t('faceFilters.look.saved'), denied: t('faceFilters.look.denied') };
    const disabled = busy || saving;
    return <View style={styles.screen}>
        {source ? <View style={styles.preview}><EffectPhoto source={source} stack={compare ? DEFAULT_STACK : stack} inference={compare ? null : inference} label={t('faceFilterSwitch.attached')} maxHeight={screenHeight * .35} onError={renderError} onReady={rendered} /></View> : null}
        <ScrollView contentContainerStyle={styles.body}>
        <RouteStack.Screen options={{ title: t('liveEdit.title') }} />
        <Text accessibilityLiveRegion="polite" tone={['failed', 'invalid', 'denied', 'unsupportedFormat', 'tooLarge'].includes(status) ? 'danger' : 'secondary'}>{messages[status]}</Text>
        <Button variant="secondary" label={t('liveEdit.pick')} disabled={disabled} onPress={() => void pick()} />
        {clip ? <View style={styles.section}><Text>{t('liveEdit.clip')}</Text><StrengthSlider tone="surface" label={t('liveEdit.framePosition')} value={position} disabled={disabled} onChange={setPosition} /><Button variant="secondary" label={t('liveEdit.frame')} disabled={disabled} onPress={() => void selectFrame()} /></View> : null}
        {source ? <>
            {foreground ? <VisionBridge key={`${source.sourceId}:${source.frameId}:${retry}`} frame={source.frame} onResult={receive} onError={() => { if (inferenceGeneration !== lifecycle.current.generation) return; lifecycle.current.fail(inferenceGeneration); setInference(null); setStatus('failed'); }} /> : null}
            <View style={styles.row}>
                <Button variant="secondary" label={t('liveEdit.compare')} accessibilityState={{ selected: compare }} disabled={disabled} onPress={() => setCompare(v => !v)} />
                <Button variant="secondary" label={t('liveEdit.undo')} disabled={disabled || !timeline.current.canUndo} onPress={() => { timeline.current.undo(); setStack(timeline.current.value); markDirty(); }} />
                <Button variant="secondary" label={t('liveEdit.redo')} disabled={disabled || !timeline.current.canRedo} onPress={() => { timeline.current.redo(); setStack(timeline.current.value); markDirty(); }} />
            </View>
            <Button label={t('faceFilters.look.save')} loading={saving} disabled={disabled || !renderReady || compare || !lifecycle.current.canSave || status === 'loading'} onPress={() => void save()} />
            {status === 'failed' ? <Button variant="secondary" label={t('liveEdit.retry')} disabled={disabled} onPress={() => { lifecycle.current.reset(); setInference(null); setStatus('loading'); setRetry(n => n + 1); setStack(timeline.current.value); }} /> : null}
            <LookStrip thumb={source.frame.jpeg} enabled={!compare} live look={stack.look} modelId={null} models={[]} busy={disabled} onLook={look => change({ ...stack, look })} onModel={() => {}} />
            <View style={styles.section}><Text>{t('faceFilters.look.strength')}</Text><StrengthSlider onChangeStart={beginChange} onChangeEnd={endChange} tone="surface" label={t('faceFilters.look.strength')} value={stack.strength} disabled={disabled || compare} onChange={strength => change({ ...stack, strength })} /></View>
            <EffectControls onChangeStart={beginChange} onChangeEnd={endChange} value={stack} onChange={change} face={inference?.count === 1} hair={!!inference?.hair} disabled={disabled || compare} />
        </> : null}
        <Text tone="secondary">{t('liveEdit.privacy')}</Text>
    </ScrollView></View>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, preview: { paddingHorizontal: ds.space.gutter, paddingTop: ds.space.sm }, body: { padding: ds.space.gutter, gap: ds.space.lg }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm }, section: { gap: ds.space.sm } }));
