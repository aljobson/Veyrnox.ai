import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ApiClient } from '../../lib/api';
import { touchTarget } from '../../lib/a11y';
import { t } from '../../lib/i18n';
import { rawText } from '../../lib/i18n/translate';
import { nativeColorPickerAvailable, pickNativeColor } from '../../lib/nativeColorPicker';
import type { Timeline } from '../../lib/nativeEditorModel';
import { studioColors as colors, ds, fonts } from '../../theme';
import { PlaybackPreview } from './EditorPlayback';
import type { FrameStore } from './editorFrameStore';
import { ColourField } from './tools/ColourField';

export type EditorCover = { frame: number; text: string; text_color: string };

const COVER_SWATCHES = [
    '#FFFFFF', '#000000', '#2C2C2E', '#8E8E93', '#FFD60A', '#FFCC00', '#FF453A', '#FF9500',
    '#34C759', '#30D158', '#00C7BE', '#64D2FF', '#0A84FF', '#5E5CE6', '#BF5AF2', '#FF2D55',
    '#F2F2F7', '#636366', '#A2845E', '#FF9F0A', '#32D74B', '#40C8E0', '#007AFF', '#AF52DE',
] as const;

function clampFrame(value: number, max: number) { return Math.max(0, Math.min(max, Math.round(value))); }

function CoverFrameScrubber({ value, max, fps, frameStore, format, onCommit }: {
    value: number; max: number; fps: number; frameStore: FrameStore; format(value: number): string; onCommit(value: number): void;
}) {
    const [live, setLive] = useState(value);
    const width = useRef(0), active = useRef(false), origin = useRef(0), pending = useRef<number | null>(null), liveRef = useRef(value);
    const animation = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
    const current = useRef({ value, max, fps, frameStore, onCommit }); current.current = { value, max, fps, frameStore, onCommit };
    const apply = (next: number) => { const bounded = clampFrame(next, current.current.max); pending.current = null; liveRef.current = bounded; current.current.frameStore.set(bounded); setLive(bounded); return bounded; };
    const cancelQueued = () => { if (animation.current !== null) cancelAnimationFrame(animation.current); animation.current = null; pending.current = null; };
    const flushQueued = () => {
        if (animation.current !== null) cancelAnimationFrame(animation.current);
        animation.current = null;
        return pending.current === null ? liveRef.current : apply(pending.current);
    };
    const queue = (next: number) => {
        pending.current = clampFrame(next, current.current.max);
        if (animation.current !== null) return;
        animation.current = requestAnimationFrame(() => { animation.current = null; if (pending.current !== null) apply(pending.current); });
    };
    const at = (x: number) => width.current <= 0 ? current.current.value : x / width.current * current.current.max;
    const [responder] = useState(() => PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: (event, gesture) => { active.current = true; origin.current = event.nativeEvent.locationX - gesture.dx; queue(at(event.nativeEvent.locationX)); },
        onPanResponderMove: (_, gesture) => { if (active.current) queue(at(origin.current + gesture.dx)); },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: () => { if (!active.current) return; const next = flushQueued(); active.current = false; current.current.onCommit(next); },
        onPanResponderTerminate: () => { cancelQueued(); active.current = false; apply(current.current.value); },
    }));
    useEffect(() => {
        if (!active.current) { liveRef.current = value; setLive(value); frameStore.set(value); }
    }, [frameStore, value]);
    useEffect(() => () => cancelQueued(), []);
    const percent = max > 0 ? live / max * 100 : 0;
    return <View style={styles.scrubberWrap}>
        <View {...responder.panHandlers} onLayout={event => { width.current = event.nativeEvent.layout.width; }}
            accessible accessibilityRole="adjustable" accessibilityLabel={rawText(t('editorCover.scrub'))}
            accessibilityValue={{ min: 0, max, now: live, text: rawText(format(live)) }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={event => {
                const direction = event.nativeEvent.actionName === 'increment' ? 1 : event.nativeEvent.actionName === 'decrement' ? -1 : 0;
                if (!direction) return;
                cancelQueued(); const next = apply(live + direction * Math.max(1, Math.round(fps))); current.current.onCommit(next);
            }} style={[touchTarget, styles.scrubber]}>
            <View pointerEvents="none" style={styles.scrubberStart} />
            <View pointerEvents="none" style={styles.scrubberRail} />
            <View pointerEvents="none" style={[styles.scrubberThumb, { left: `${percent}%` }]} />
        </View>
    </View>;
}

export function EditorCoverSheet({ initial, frameStore, total, timeline, aspectRatio, api, localMediaUris, fontReady, onFrame, onCancel, onSave }: {
    initial: EditorCover; frameStore: FrameStore; total: number; timeline: Timeline; aspectRatio: number; api: Pick<ApiClient, 'request'>;
    localMediaUris: Record<string, string>; fontReady?(family: string): boolean; onFrame(frame: number): void; onCancel(): void; onSave(cover: EditorCover): void;
}) {
    const insets = useSafeAreaInsets();
    const maxFrame = Math.max(0, total - 1);
    const [frame, setFrame] = useState(Math.max(0, Math.min(maxFrame, initial.frame)));
    const [text, setText] = useState(initial.text);
    const [textColor, setTextColor] = useState(initial.text_color);
    const hasNativeColorPicker = nativeColorPickerAvailable();
    const chooseFrame = (value: number) => {
        const next = Math.max(0, Math.min(maxFrame, Math.round(value)));
        setFrame(next); onFrame(next);
    };
    const time = (value: number) => `${Math.floor(value / timeline.fps / 60).toString().padStart(2, '0')}:${Math.floor(value / timeline.fps % 60).toString().padStart(2, '0')}`;
    return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onCancel} accessibilityViewIsModal>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
            <View testID="editor-cover-header" style={[styles.header, { minHeight: 64 + insets.top, paddingTop: insets.top,
                paddingLeft: 12 + insets.left, paddingRight: 12 + insets.right }]}>
                <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('editorCover.cancel'))} onPress={onCancel} style={[touchTarget, styles.headerAction]}>
                    <Text style={styles.headerActionText}>{t('editorCover.cancel')}</Text>
                </Pressable>
                <Text accessibilityRole="header" style={styles.title}>{t('editorCover.title')}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('editorCover.save'))} onPress={() => onSave({ frame, text: text.trim(), text_color: textColor })}
                    style={[touchTarget, styles.headerAction]}><Text style={styles.headerActionText}>{t('editorCover.save')}</Text></Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: 42 + insets.bottom,
                paddingLeft: ds.space.lg + insets.left, paddingRight: ds.space.lg + insets.right }]}>
                <View style={[styles.preview, { aspectRatio }]}>
                    <PlaybackPreview frameStore={frameStore} timeline={timeline} api={api} playing={false} localMediaUris={localMediaUris} fontReady={fontReady} staticPreview compositionFrame={false} />
                    {text.trim() ? <Text pointerEvents="none" numberOfLines={3} adjustsFontSizeToFit style={[styles.coverText, { color: textColor }]}>{text.trim()}</Text> : null}
                </View>
                <CoverFrameScrubber value={frame} max={maxFrame} fps={timeline.fps} frameStore={frameStore} format={time} onCommit={chooseFrame} />
                <Text style={styles.help}>{t('editorCover.help')}</Text>
                <View style={styles.field}>
                    <TextInput accessibilityLabel={rawText(t('editorCover.text'))} value={text} onChangeText={setText} maxLength={120} placeholder={t('editorCover.textPlaceholder')}
                        placeholderTextColor={colors.muted} style={styles.input} returnKeyType="done" />
                </View>
                <ColourField label={t('editorCover.textColor')} value={textColor} swatches={COVER_SWATCHES} onChange={setTextColor}
                    presentation="horizontal" commitValidOnChange onOpenPicker={hasNativeColorPicker ? () => pickNativeColor(textColor) : undefined} />
                <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('editorCover.hideText'))} accessibilityState={{ disabled: !text }}
                    disabled={!text} onPress={() => setText('')} style={[touchTarget, styles.hideText, !text && styles.hideTextDisabled]}>
                    <Text style={styles.hideTextLabel}>{t('editorCover.hideText')}</Text>
                </Pressable>
            </ScrollView>
        </KeyboardAvoidingView>
    </Modal>;
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
    title: { flex: 1, color: colors.text, fontFamily: fonts.display, fontSize: 19, textAlign: 'center' },
    headerAction: { minWidth: 66, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
    headerActionText: { color: colors.accent, fontSize: 16, fontWeight: '800' },
    content: { alignItems: 'stretch', gap: ds.space.lg, paddingTop: ds.space.lg },
    preview: { width: '100%', maxWidth: 560, maxHeight: 520, alignSelf: 'center', overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: '#050506' },
    coverText: { position: 'absolute', left: 24, right: 24, bottom: 28, fontFamily: fonts.displayHeavy, fontSize: 29, fontWeight: '900', textAlign: 'center', textShadowColor: 'rgba(0,0,0,.9)', textShadowRadius: 5 },
    scrubberWrap: { paddingHorizontal: 8 },
    scrubber: { justifyContent: 'center', marginHorizontal: 4 },
    scrubberRail: { height: 8, borderRadius: 4, backgroundColor: '#5B586C' },
    scrubberStart: { position: 'absolute', left: -8, width: 4, height: 44, borderRadius: 2, backgroundColor: colors.accent },
    scrubberThumb: { position: 'absolute', width: 22, height: 22, marginLeft: -11, borderRadius: 11, backgroundColor: colors.accent },
    help: { color: colors.muted, fontSize: 13, lineHeight: 18, textAlign: 'center' },
    field: { gap: 8 },
    input: { minHeight: 50, color: colors.text, fontSize: 16, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
    hideText: { alignSelf: 'flex-start', justifyContent: 'center' }, hideTextDisabled: { opacity: .45 },
    hideTextLabel: { color: colors.accent, fontSize: 15, fontWeight: '800' },
});
