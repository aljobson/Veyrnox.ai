import { Stack as RouteStack, router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { t } from '../../lib/i18n';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { discardCacheCopy } from '../../lib/cacheFiles';
import { jpegCopy, offerPhoto } from '../../lib/liveEdit/faceFilterHandoff';
import { DEFAULT_STACK, history, isWig3d, type Stack } from '../../lib/liveEdit/engine';
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
import { Dial } from './Dial';
import { ToolStrip, type Tool } from './ToolStrip';
import { AiWigPanel, HairPanel, MakeupPanel, RetouchPanel } from './Panels';
import { wigStatus, clearOverlays, getOverlay, overlayKey, pinOverlay, unpinOverlay, type WigStatus } from '../../lib/liveEdit/wig';
import { VisionBridge } from './VisionBridge';
import { LiveCameraView, type LiveCameraHandle } from './LiveCameraView';
import { Wig3dBridge } from './Wig3dBridge';
import { liveErrorKey, type LiveError, type LiveFace, type LiveWig } from '../../lib/liveEdit/liveProtocol';
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
    // Live camera (S8): the preview is a WebView that owns the camera; leaving this mode (or the app) unmounts it, which releases the camera.
    const [camera, setCamera] = useState<'off' | 'starting' | 'on'>('off'), [liveFace, setLiveFace] = useState<LiveFace>('detecting'), [, setLiveWig] = useState<LiveWig>('off');
    const [tool, setTool] = useState<Tool>('looks'), [canvas, setCanvas] = useState(0);
    const [cameraError, setCameraError] = useState<LiveError | null>(null), [cameras, setCameras] = useState(0);
    const cameraRef = useRef<LiveCameraHandle>(null);
    // A 3D wig overlay is rendered asynchronously by the WebView; this counter redraws the photo when one arrives.
    const [overlayRevision, setOverlayRevision] = useState(0);
    const inferenceGeneration = lifecycle.current.generation;
    const current = () => mounted.current && !controller.current.signal.aborted && getCacheUser() === owner;
    useEffect(() => {
        mounted.current = true;
        const off = subscribeCacheUser(() => { if (getCacheUser() !== owner) { controller.current.abort(); epoch.current++; setSource(null); setInference(null); discardCacheCopy(sourceRef.current?.uri); sourceRef.current = null; } });
        const sub = AppState.addEventListener('change', state => {
            const action = lifecycle.current.transition(state);
            if (action === 'suspend') { setCamera('off'); setForeground(false); setInference(null); setRenderReady(false); }
            // Only a still photo has inference to redo: a camera session that was closed by backgrounding just stays closed.
            if (action === 'refresh') { setForeground(true); if (sourceRef.current) { setStatus('loading'); setRenderReady(false); setRetry(n => n + 1); } }
        });
        return () => { mounted.current = false; controller.current.abort(); epoch.current++; off(); sub.remove(); discardCacheCopy(sourceRef.current?.uri); clearOverlays(); };
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
        locking.current = true; setBusy(true); setCamera('off'); setCompare(false); setCameraError(null);
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
    function startCamera() {
        if (locking.current || !current()) return;
        // Same as choosing another photo: drop any in-flight still, then open the camera.
        controller.current.abort(); controller.current = new AbortController(); epoch.current++;
        discardCacheCopy(sourceRef.current?.uri); sourceRef.current = null;
        setSource(null); setInference(null); setClip(null); setRenderReady(false); setStatus('empty');
        setCameraError(null); setLiveFace('detecting'); setLiveWig('off'); setCompare(false); setCamera('starting');
    }
    const stopCamera = () => { setCamera('off'); setCompare(false); };
    async function openAiWig() {
        if (locking.current || !current()) return;
        locking.current = true; setBusy(true); setCamera('off'); setCompare(false); // leaving this screen must release the camera
        try {
            if (sourceRef.current) { const file = await jpegCopy(sourceRef.current.uri); if (current()) offerPhoto(owner, file); else discardCacheCopy(file.uri); }
        } catch { /* The person can still choose the photo in Face Filters. */ }
        finally { locking.current = false; if (mounted.current) setBusy(false); }
        if (current()) router.push('/face-filters');
    }
    async function cameraPhoto(uri: string) {
        // The captured frame (raw, not mirrored, no effects) goes through the normal still flow, where hair and wig coverage work at full quality.
        setCamera('off'); setCompare(false); setCameraError(null);
        try { await load(uri); } finally { discardCacheCopy(uri); }
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
        // A 3D wig is a pre-rendered overlay: pin the one this save starts with, and refuse (never silently drop the wig) if it is not there.
        const overlay = isWig3d(stack.wig.style) && stack.wig.strength > 0 && inference?.count === 1 ? overlayKey(stack.wig, inference.landmarks, source.width, source.height) : null;
        if (overlay && !getOverlay(overlay)) { setStatus('failed'); return; }
        if (overlay) pinOverlay(overlay);
        locking.current = true; setSaving(true); const generation = epoch.current, lease = lifecycle.current.generation;
        try {
            const saved = await saveEffectsToPhotos(source.uri, stack, inference, source, () => current() && generation === epoch.current && lifecycle.current.owns(lease));
            if (current() && lifecycle.current.owns(lease)) setStatus(saved ? 'saved' : 'denied');
        } catch { if (current() && lifecycle.current.owns(lease)) setStatus('failed'); }
        finally { if (overlay) unpinOverlay(overlay); locking.current = false; if (mounted.current) setSaving(false); }
    }
    const renderError = useCallback(() => { setRenderReady(false); setStatus('failed'); }, []);
    const rendered = useCallback(() => setRenderReady(true), []);
    const messages: Record<Status, string> = { empty: t('liveEdit.intro'), loading: t('liveEdit.loading'), ready: t('liveEdit.ready'), noFace: t('liveEdit.noFace'), multiple: t('liveEdit.multiple'), noHair: t('liveEdit.noHair'), failed: t('liveEdit.failed'), invalid: t('liveEdit.invalid'), unsupportedFormat: t('liveEdit.unsupportedFormat'), tooLarge: t('liveEdit.tooLarge'), saved: t('faceFilters.look.saved'), denied: t('faceFilters.look.denied') };
    const disabled = busy || saving;
    // Derived from the same plan the renderer uses; never throws into the screen (a failed probe just means "unknown").
    const wigState = useMemo<WigStatus>(() => {
        if (!source || stack.wig.style === 'none') return 'off';
        try { return wigStatus(stack.wig, stack.hair, inference, source.width, source.height); } catch { return 'coverage-unknown'; }
    }, [source, stack.wig, stack.hair, inference, overlayRevision]); // eslint-disable-line react-hooks/exhaustive-deps
    const live = camera !== 'off';
    const faceOn = live ? liveFace === 'one-face' : inference?.count === 1, hairOn = live ? false : !!inference?.hair;
    const cameraMessages = { denied: t('liveEdit.camera.denied'), missing: t('liveEdit.camera.missing'), busy: t('liveEdit.camera.busy'), unsupported: t('liveEdit.camera.unsupported'), lost: t('liveEdit.camera.lost'), failed: t('liveEdit.camera.failed') };
    const liveMessages: Record<LiveFace, string> = { detecting: t('liveEdit.camera.on'), 'one-face': t('liveEdit.camera.on'), 'no-face': t('liveEdit.camera.noFace'), 'multiple-faces': t('liveEdit.camera.multiple'), 'face-unavailable': t('liveEdit.camera.faceUnavailable') };
    const headline = cameraError ? cameraMessages[liveErrorKey(cameraError)] : live ? (camera === 'starting' ? t('liveEdit.camera.starting') : liveMessages[liveFace]) : messages[status];
    const bad = !!cameraError || (!live && ['failed', 'invalid', 'denied', 'unsupportedFormat', 'tooLarge'].includes(status));
    const common = { stack, onChange: change, onChangeStart: beginChange, onChangeEnd: endChange, face: faceOn, hair: hairOn, disabled: disabled || compare };
    const dock = source || live;
    const panel = tool === 'looks'
        ? <View style={styles.panel}>
            <LookStrip thumb={source?.frame.jpeg ?? null} enabled={!compare} live look={stack.look} modelId={null} models={[]} busy={disabled} onLook={look => change({ ...stack, look })} onModel={() => {}} />
            <Dial label={t('faceFilters.look.strength')} value={stack.strength} disabled={disabled || compare} onChangeStart={beginChange} onChangeEnd={endChange} onChange={strength => change({ ...stack, strength })} />
        </View>
        : tool === 'retouch' ? <RetouchPanel {...common} />
        : tool === 'makeup' ? <MakeupPanel {...common} />
        : tool === 'hair' ? <HairPanel {...common} live={live} />
        : <AiWigPanel onOpen={() => void openAiWig()} disabled={disabled} />;
    return <View style={styles.screen}>
        <RouteStack.Screen options={{ title: t('liveEdit.title') }} />
        <View style={styles.top}>
            <View style={styles.row}>
                <Button variant="tertiary" size="sm" iconOnly icon="image" label={t('liveEdit.pick')} disabled={disabled} onPress={() => void pick()} />
                {live ? null : <Button variant="tertiary" size="sm" iconOnly icon="camera" label={t('liveEdit.camera.start')} disabled={disabled} onPress={startCamera} />}
                {dock ? <>
                    <Button variant="tertiary" size="sm" label={t('liveEdit.undo')} disabled={disabled || !timeline.current.canUndo} onPress={() => { timeline.current.undo(); setStack(timeline.current.value); markDirty(); }} />
                    <Button variant="tertiary" size="sm" label={t('liveEdit.redo')} disabled={disabled || !timeline.current.canRedo} onPress={() => { timeline.current.redo(); setStack(timeline.current.value); markDirty(); }} />
                </> : null}
                {live ? <Button variant="tertiary" size="sm" label={t('liveEdit.compare')} accessibilityState={{ selected: compare }} onPress={() => setCompare(v => !v)} /> : null}
            </View>
            {source ? <Button size="sm" label={t('faceFilters.look.save')} loading={saving} disabled={disabled || !renderReady || compare || !lifecycle.current.canSave || status === 'loading' || wigState === 'loading'} onPress={() => void save()} /> : null}
        </View>
        <View style={styles.canvas} onLayout={event => setCanvas(event.nativeEvent.layout.height)}>
            {live && !cameraError ? <LiveCameraView ref={cameraRef} stack={stack} compare={compare} height={canvas}
                onStarted={count => { setCamera('on'); setCameras(count); }} onFace={setLiveFace} onWig={setLiveWig}
                onError={code => { setCameraError(code); setCamera('off'); }} onPhoto={uri => void cameraPhoto(uri)} /> : null}
            {source ? <Pressable accessibilityRole="imagebutton" accessibilityLabel={t('liveEdit.compare')} accessibilityHint={t('liveEdit.holdCompare')} accessibilityActions={[{ name: 'activate' }]} onAccessibilityAction={() => setCompare(v => !v)}
                disabled={disabled} onPressIn={() => setCompare(true)} onPressOut={() => setCompare(false)}>
                <EffectPhoto source={source} stack={compare ? DEFAULT_STACK : stack} inference={compare ? null : inference} label={t('faceFilterSwitch.attached')} maxHeight={canvas} revision={overlayRevision} onError={renderError} onReady={rendered} />
            </Pressable> : null}
            {!source && !live ? <View style={styles.empty}>
                <Text variant="title3" style={styles.centre}>{t('liveEdit.title')}</Text>
                <Text tone={bad ? 'danger' : 'secondary'} accessibilityLiveRegion="polite" style={styles.centre}>{headline}</Text>
                <Button label={t('liveEdit.pick')} disabled={disabled} onPress={() => void pick()} />
                <Button variant="secondary" label={t('liveEdit.camera.start')} disabled={disabled} onPress={startCamera} />
                <Text variant="footnote" tone="secondary" style={styles.centre}>{t('liveEdit.privacy')}</Text>
            </View> : null}
            {live && cameraError ? <View style={styles.empty}><Text tone="danger" accessibilityLiveRegion="polite" style={styles.centre}>{headline}</Text><Button label={t('liveEdit.retry')} onPress={() => { setCameraError(null); startCamera(); }} /></View> : null}
        </View>
        {dock ? <View style={styles.status}>
            <Text variant="footnote" accessibilityLiveRegion="polite" tone={bad ? 'danger' : 'secondary'} style={styles.centre}>{headline}</Text>
            {source && status === 'failed' ? <Button variant="tertiary" size="sm" label={t('liveEdit.retry')} disabled={disabled} onPress={() => { lifecycle.current.reset(); setInference(null); setStatus('loading'); setRetry(n => n + 1); setStack(timeline.current.value); }} /> : null}
            {source && !live && status !== 'failed' ? <Text variant="micro" tone="tertiary" style={styles.centre}>{t('liveEdit.holdCompare')}</Text> : null}
        </View> : null}
        {live ? <View style={styles.shutter}>
            <Button variant="tertiary" label={t('liveEdit.camera.stop')} onPress={stopCamera} />
            <Pressable accessibilityRole="button" accessibilityLabel={t('liveEdit.camera.take')} accessibilityState={{ disabled: disabled || camera !== 'on' }} disabled={disabled || camera !== 'on'} onPress={() => cameraRef.current?.capture()} style={[styles.ring, (disabled || camera !== 'on') && styles.ringOff]}><View style={styles.core} /></Pressable>
            {cameras > 1 ? <Button variant="tertiary" label={t('liveEdit.camera.switch')} disabled={camera !== 'on'} onPress={() => cameraRef.current?.switchCamera()} /> : <View style={styles.spacer} />}
        </View> : null}
        {clip ? <View style={styles.clip}><Text variant="footnote">{t('liveEdit.clip')}</Text><StrengthSlider tone="surface" label={t('liveEdit.framePosition')} value={position} disabled={disabled} onChange={setPosition} /><Button variant="secondary" size="sm" label={t('liveEdit.frame')} disabled={disabled} onPress={() => void selectFrame()} /></View> : null}
        {dock ? <View style={styles.dock}>
            <ScrollView style={{ maxHeight: screenHeight * .38 }} contentContainerStyle={styles.panelBody}>{panel}</ScrollView>
            <ToolStrip value={tool} onChange={setTool} />
        </View> : null}
        {source && foreground ? <VisionBridge key={`${source.sourceId}:${source.frameId}:${retry}`} frame={source.frame} onResult={receive} onError={() => { if (inferenceGeneration !== lifecycle.current.generation) return; lifecycle.current.fail(inferenceGeneration); setInference(null); setStatus('failed'); }} /> : null}
        {source && foreground && inference?.count === 1 && isWig3d(stack.wig.style) && stack.wig.strength > 0 ? <Wig3dBridge job={{ wig: stack.wig, landmarks: inference.landmarks, width: source.width, height: source.height }} onChange={() => setOverlayRevision(n => n + 1)} /> : null}
    </View>;
}
const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: ds.space.md, paddingVertical: ds.space.xs },
    row: { flexDirection: 'row', alignItems: 'center', gap: ds.space.xs },
    canvas: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: ds.space.sm },
    empty: { alignItems: 'stretch', gap: ds.space.md, paddingHorizontal: ds.space.gutter },
    centre: { textAlign: 'center' },
    status: { alignItems: 'center', paddingHorizontal: ds.space.gutter, paddingVertical: ds.space.xs },
    shutter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: ds.space.gutter, paddingVertical: ds.space.sm },
    ring: { width: 64, height: 64, borderRadius: ds.radius.pill, borderWidth: 3, borderColor: p.textPrimary, alignItems: 'center', justifyContent: 'center' },
    ringOff: { opacity: 0.4 },
    core: { width: 50, height: 50, borderRadius: ds.radius.pill, backgroundColor: p.textPrimary },
    spacer: { width: 64 },
    clip: { gap: ds.space.sm, paddingHorizontal: ds.space.gutter, paddingBottom: ds.space.sm },
    dock: { backgroundColor: p.bgElevated1, borderTopLeftRadius: ds.radius.lg, borderTopRightRadius: ds.radius.lg, paddingTop: ds.space.md, paddingBottom: ds.space.sm, gap: ds.space.sm },
    panel: { gap: ds.space.sm },
    panelBody: { paddingHorizontal: ds.space.md, paddingBottom: ds.space.xs },
}));
