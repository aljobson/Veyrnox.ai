import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useOptionalSafeAreaInsets } from '../../lib/safeArea';
import { studioColors as colors, fonts } from '../../theme';
import type { Canvas, CanvasAspect, Timeline } from '../../lib/nativeEditorModel';
import { customCanvasParts, formatCustomCanvasAspect } from '../../lib/nativeEditorModel';
import { Icon } from '../ui';
import { ColourField } from './tools/ColourField';
import { Slider } from './tools/Slider';

const RATIOS: readonly CanvasAspect[] = ['9:16', '16:9', '1:1', '4:5'];
const BACKGROUND_SWATCHES = ['#000000', '#FFFFFF', '#292A2D', '#9B9B9F', '#FF3B30', '#FF9500', '#FFD60A', '#34C759', '#00C7BE', '#0A84FF', '#5E5CE6'] as const;

function gcd(a: number, b: number): number {
    let x = Math.max(1, Math.round(a)), y = Math.max(1, Math.round(b));
    while (y) [x, y] = [y, x % y];
    return x;
}

function originalAspect(timeline: Timeline): CanvasAspect | null {
    const media = Object.values(timeline.media).find(item => (item.kind === 'video' || item.kind === 'image') && Number(item.width) > 0 && Number(item.height) > 0);
    if (!media) return null;
    const sourceWidth = Number(media.width), sourceHeight = Number(media.height);
    const divisor = gcd(sourceWidth, sourceHeight), width = Math.round(sourceWidth / divisor), height = Math.round(sourceHeight / divisor);
    if (width / height < .25 || width / height > 4) return null;
    return `custom:${width}x${height}`;
}

export function EditorCanvasSheet({ visible, canvas, timeline, onClose, onCanvas, onTimeline }: {
    visible: boolean;
    canvas: Canvas;
    timeline: Timeline;
    onClose(): void;
    onCanvas(patch: Partial<Canvas>): void;
    onTimeline(next: Timeline): void;
}) {
    const insets = useOptionalSafeAreaInsets();
    const parts = customCanvasParts(canvas.aspect_ratio);
    const [customWidth, setCustomWidth] = useState(String(parts?.width ?? 4));
    const [customHeight, setCustomHeight] = useState(String(parts?.height ?? 5));
    useEffect(() => {
        const next = customCanvasParts(canvas.aspect_ratio);
        if (next) { setCustomWidth(String(next.width)); setCustomHeight(String(next.height)); }
    }, [canvas.aspect_ratio]);
    const sourceAspect = useMemo(() => originalAspect(timeline), [timeline]);
    const firstBackground = timeline.video.find(item => item.background && item.background.type !== 'none')?.background;
    type BackgroundMode = 'solid' | 'gradient' | 'blur' | 'image' | 'video';
    const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(['gradient', 'blur', 'image', 'video'].includes(firstBackground?.type || '') ? firstBackground!.type as BackgroundMode : 'solid');
    const [blur, setBlur] = useState(firstBackground?.blur ?? 24);
    const images = useMemo(() => Object.values(timeline.media).filter(item => item.kind === 'image' || item.kind === 'graphic'), [timeline.media]);
    const videos = useMemo(() => Object.values(timeline.media).filter(item => item.kind === 'video'), [timeline.media]);
    const [backgroundMediaId, setBackgroundMediaId] = useState(firstBackground?.mediaId || images[0]?.id || videos[0]?.id || '');
    const [gradientEnd, setGradientEnd] = useState(firstBackground?.secondaryColor || '#4B2BFF');
    const [gradientAngle, setGradientAngle] = useState(firstBackground?.angle ?? 135);
    const fit = timeline.video.some(item => item.fit === 'cover') ? 'cover' : 'contain';
    const setFit = (next: 'contain' | 'cover') => onTimeline({ ...timeline, video: timeline.video.map(item => ({ ...item, fit: next })) });
    const applyCustom = () => {
        const value = formatCustomCanvasAspect(customWidth, customHeight);
        if (value) onCanvas({ aspect_ratio: value });
    };
    const applyBackdrop = (type: BackgroundMode, patch: { color?: string; secondaryColor?: string; angle?: number; blur?: number; mediaId?: string } = {}) => {
        onTimeline({ ...timeline, video: timeline.video.map(item => {
            const base = { type, color: patch.color ?? item.background?.color ?? timeline.background, blur: patch.blur ?? item.background?.blur ?? blur, mediaId: '' } as NonNullable<typeof item.background>;
            const background = type === 'gradient' ? { ...base, secondaryColor: patch.secondaryColor ?? item.background?.secondaryColor ?? gradientEnd,
                angle: patch.angle ?? item.background?.angle ?? gradientAngle }
                : type === 'image' || type === 'video' ? { ...base, mediaId: patch.mediaId ?? backgroundMediaId } : base;
            return { ...item, background };
        }) });
    };
    const chooseBackgroundMode = (mode: BackgroundMode) => {
        const mediaId = mode === 'video' ? videos[0]?.id : mode === 'image' ? images[0]?.id : undefined;
        setBackgroundMode(mode); if (mediaId) setBackgroundMediaId(mediaId); applyBackdrop(mode, { mediaId });
    };
    return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} accessibilityViewIsModal>
        <Pressable accessible={false} style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(24, (insets?.bottom ?? 0) + 14) }]}>
            <View style={styles.grabber} />
            <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>Canvas Settings</Text><Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={onClose} style={styles.done}><Text style={styles.doneText}>Done</Text></Pressable></View>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <Text style={styles.sectionTitle}>Format</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ratios}>
                    {RATIOS.map(ratio => <Choice key={ratio} label={ratio} selected={canvas.aspect_ratio === ratio} onPress={() => onCanvas({ aspect_ratio: ratio })} />)}
                    <Choice label="Original" selected={!!sourceAspect && canvas.aspect_ratio === sourceAspect} disabled={!sourceAspect} onPress={() => { if (sourceAspect) onCanvas({ aspect_ratio: sourceAspect }); }} />
                    <Choice label="Custom" selected={!!parts && canvas.aspect_ratio !== sourceAspect} onPress={applyCustom} />
                </ScrollView>
                <View style={styles.customRow}>
                    <TextInput accessibilityLabel="Custom canvas width" keyboardType="number-pad" value={customWidth} onChangeText={setCustomWidth} maxLength={3} style={styles.numberInput} />
                    <Text style={styles.customSeparator}>:</Text>
                    <TextInput accessibilityLabel="Custom canvas height" keyboardType="number-pad" value={customHeight} onChangeText={setCustomHeight} maxLength={3} style={styles.numberInput} />
                    <Pressable accessibilityRole="button" accessibilityLabel="Apply custom canvas" onPress={applyCustom} style={styles.apply}><Text style={styles.applyText}>Apply</Text></Pressable>
                </View>

                <Text style={styles.sectionTitle}>Fit Mode</Text>
                <View style={styles.segmented}>
                    <Pressable accessibilityRole="button" accessibilityState={{ selected: fit === 'contain' }} onPress={() => setFit('contain')} style={[styles.segment, fit === 'contain' && styles.segmentSelected]}><Text style={[styles.segmentText, fit === 'contain' && styles.segmentTextSelected]}>Fit</Text></Pressable>
                    <Pressable accessibilityRole="button" accessibilityState={{ selected: fit === 'cover' }} onPress={() => setFit('cover')} style={[styles.segment, fit === 'cover' && styles.segmentSelected]}><Text style={[styles.segmentText, fit === 'cover' && styles.segmentTextSelected]}>{fit === 'cover' ? '✓  ' : ''}Fill</Text></Pressable>
                </View>
                <Text style={styles.help}>{fit === 'cover' ? "Fills the canvas and crops the clip's edges." : 'Shows the whole clip inside the canvas without cropping.'}</Text>

                <Text style={styles.sectionTitle}>Background</Text>
                <View style={styles.backgroundModes}>
                    <BackgroundChoice icon="palette" label="Color" selected={backgroundMode === 'solid'} onPress={() => chooseBackgroundMode('solid')} />
                    <BackgroundChoice icon="swatches" label="Gradient" selected={backgroundMode === 'gradient'} onPress={() => chooseBackgroundMode('gradient')} />
                    <BackgroundChoice icon="contrast" label="Blur" selected={backgroundMode === 'blur'} onPress={() => chooseBackgroundMode('blur')} />
                    <BackgroundChoice icon="image" label="Image" selected={backgroundMode === 'image'} disabled={!images.length} onPress={() => chooseBackgroundMode('image')} />
                    <BackgroundChoice icon="film" label="Video" selected={backgroundMode === 'video'} disabled={!videos.length} onPress={() => chooseBackgroundMode('video')} />
                </View>
                {backgroundMode === 'solid' ? <ColourField label="Canvas color" value={timeline.background} swatches={BACKGROUND_SWATCHES} onChange={background => { onTimeline({ ...timeline, background, video: timeline.video.map(item => ({ ...item, background: { type: 'solid', color: background, blur: item.background?.blur ?? blur, mediaId: '' } })) }); }} /> : null}
                {backgroundMode === 'blur' ? <Slider label="Blur" value={blur} min={4} max={60} step={1} format={value => `${Math.round(value)}`} onChange={value => { setBlur(value); applyBackdrop('blur', { blur: value }); }} /> : null}
                {backgroundMode === 'gradient' ? <><ColourField label="Gradient end color" value={gradientEnd} swatches={BACKGROUND_SWATCHES} onChange={secondaryColor => { setGradientEnd(secondaryColor); applyBackdrop('gradient', { secondaryColor }); }} /><Slider label="Gradient angle" value={gradientAngle} min={0} max={360} step={15} format={value => `${Math.round(value)}°`} onChange={angle => { setGradientAngle(angle); applyBackdrop('gradient', { angle }); }} /></> : null}
                {backgroundMode === 'image' ? <View style={styles.imageChoices}>{images.map(item => <Choice key={item.id} label={(item.name || 'Image').slice(0, 26)} selected={backgroundMediaId === item.id} onPress={() => { setBackgroundMediaId(item.id); applyBackdrop('image', { mediaId: item.id }); }} />)}</View> : null}
                {backgroundMode === 'video' ? <View style={styles.imageChoices}>{videos.map(item => <Choice key={item.id} label={(item.name || 'Video').slice(0, 26)} selected={backgroundMediaId === item.id} onPress={() => { setBackgroundMediaId(item.id); applyBackdrop('video', { mediaId: item.id }); }} />)}</View> : null}
            </ScrollView>
        </View>
    </Modal>;
}

function BackgroundChoice({ icon, label, selected, disabled = false, onPress }: { icon: 'palette' | 'swatches' | 'contrast' | 'image' | 'film'; label: string; selected: boolean; disabled?: boolean; onPress(): void }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={`${label} background`} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
        style={[styles.backgroundChoice, selected && styles.backgroundChoiceSelected, disabled && styles.disabled]}><Icon name={icon} size={24} tint={selected ? colors.accent : colors.body} /><Text style={[styles.backgroundModeText, selected && { color: colors.accent }]}>{label}</Text></Pressable>;
}

function Choice({ label, selected, disabled = false, onPress }: { label: string; selected: boolean; disabled?: boolean; onPress(): void }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
        style={[styles.choice, selected && styles.choiceSelected, disabled && styles.disabled]}><Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.58)' },
    sheet: { maxHeight: '78%', borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: '#303034', backgroundColor: '#1a1a1c' },
    grabber: { width: 42, height: 5, alignSelf: 'center', marginTop: 10, borderRadius: 3, backgroundColor: '#c7c3d4' },
    header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
    title: { color: colors.text, fontFamily: fonts.display, fontSize: 20 },
    done: { position: 'absolute', end: 12, minWidth: 58, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    doneText: { color: colors.accent, fontSize: 16, fontWeight: '800' },
    content: { gap: 16, paddingHorizontal: 20, paddingBottom: 28 },
    sectionTitle: { marginTop: 3, color: colors.text, fontSize: 18, fontWeight: '800' },
    ratios: { gap: 8, paddingEnd: 14 },
    choice: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: '#57575e' },
    choiceSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    choiceText: { color: '#d4d4d8', fontSize: 16, fontWeight: '700' },
    choiceTextSelected: { color: colors.accent },
    disabled: { opacity: .35 },
    customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    numberInput: { width: 66, minHeight: 44, color: colors.text, fontSize: 16, textAlign: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#57575e', backgroundColor: '#111113' },
    customSeparator: { color: colors.muted, fontSize: 20, fontWeight: '700' },
    apply: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 22, backgroundColor: colors.accent },
    applyText: { color: colors.accentInk, fontWeight: '900' },
    segmented: { minHeight: 48, flexDirection: 'row', overflow: 'hidden', borderRadius: 24, borderWidth: 1, borderColor: '#75757d' },
    segment: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    segmentSelected: { backgroundColor: colors.accentSoft },
    segmentText: { color: colors.body, fontSize: 17, fontWeight: '700' },
    segmentTextSelected: { color: colors.accent },
    help: { color: colors.muted, fontSize: 14, lineHeight: 20 },
    backgroundModes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    backgroundChoice: { flexBasis: '30%', flexGrow: 1, minHeight: 70, alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 14, borderWidth: 1, borderColor: '#57575e' },
    backgroundChoiceSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    backgroundModeText: { color: colors.body, fontSize: 14, fontWeight: '800' },
    imageChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
