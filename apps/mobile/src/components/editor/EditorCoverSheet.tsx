import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ApiClient } from '../../lib/api';
import { touchTarget } from '../../lib/a11y';
import { formatNumber, t } from '../../lib/i18n';
import { rawText } from '../../lib/i18n/translate';
import type { Timeline } from '../../lib/nativeEditorModel';
import { colors, ds, fonts } from '../../theme';
import { PlaybackPreview } from './EditorPlayback';
import { createFrameStore, type FrameStore } from './editorFrameStore';
import { Slider } from './tools/Slider';

export type EditorCover = { frame: number; text: string; text_color: string };

const COVER_SWATCHES = ['#FFFFFF', '#000000', '#FFE66D', '#32D6C5', '#FF8BD1', '#FF5B5B', '#8DA2FF'] as const;

export function EditorCoverSheet({ initial, frameStore, total, timeline, aspectRatio, api, localMediaUris, fontReady, onFrame, onCancel, onSave }: {
    initial: EditorCover; frameStore: FrameStore; total: number; timeline: Timeline; aspectRatio: number; api: Pick<ApiClient, 'request'>;
    localMediaUris: Record<string, string>; fontReady?(family: string): boolean; onFrame(frame: number): void; onCancel(): void; onSave(cover: EditorCover): void;
}) {
    const maxFrame = Math.max(0, total - 1);
    const [frame, setFrame] = useState(Math.max(0, Math.min(maxFrame, initial.frame)));
    const [text, setText] = useState(initial.text);
    const [textColor, setTextColor] = useState(initial.text_color);
    const candidateFrames = useMemo(() => Array.from(new Set([0, .25, .5, .75, 1].map(value => Math.round(maxFrame * value)))), [maxFrame]);
    const candidateStores = useMemo(() => candidateFrames.map(value => createFrameStore(value)), [candidateFrames]);
    const chooseFrame = (value: number) => {
        const next = Math.max(0, Math.min(maxFrame, Math.round(value)));
        setFrame(next); onFrame(next);
    };
    const time = (value: number) => `${Math.floor(value / timeline.fps / 60).toString().padStart(2, '0')}:${Math.floor(value / timeline.fps % 60).toString().padStart(2, '0')}`;
    return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onCancel} accessibilityViewIsModal>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
            <View style={styles.header}>
                <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('editorCover.cancel'))} onPress={onCancel} style={[touchTarget, styles.headerAction]}>
                    <Text style={styles.headerActionText}>{t('editorCover.cancel')}</Text>
                </Pressable>
                <Text accessibilityRole="header" style={styles.title}>{t('editorCover.title')}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('editorCover.save'))} onPress={() => onSave({ frame, text: text.trim(), text_color: textColor })}
                    style={[touchTarget, styles.headerAction]}><Text style={styles.headerActionText}>{t('editorCover.save')}</Text></Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
                <View style={[styles.preview, { aspectRatio }]}>
                    <PlaybackPreview frameStore={frameStore} timeline={timeline} api={api} playing={false} localMediaUris={localMediaUris} fontReady={fontReady} staticPreview compositionFrame={false} />
                    {text.trim() ? <Text pointerEvents="none" numberOfLines={3} adjustsFontSizeToFit style={[styles.coverText, { color: textColor }]}>{text.trim()}</Text> : null}
                </View>
                <View accessibilityLabel={rawText(t('editorCover.frames'))} style={styles.frames}>
                    {candidateFrames.map((value, index) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={rawText(t('editorCover.frameAt', { value1: time(value) }))}
                        accessibilityState={{ selected: frame === value }} onPress={() => chooseFrame(value)} style={[styles.frameChoice, frame === value && styles.frameSelected]}>
                        <View style={styles.framePreview}><PlaybackPreview frameStore={candidateStores[index]} timeline={timeline} api={api} playing={false} localMediaUris={localMediaUris}
                            fontReady={fontReady} staticPreview compositionFrame={false} /></View>
                        <Text style={styles.frameTime}>{time(value)}</Text>
                    </Pressable>)}
                </View>
                <Slider label={t('editorCover.scrub')} value={frame} min={0} max={maxFrame} step={1} format={value => time(value)} onChange={chooseFrame} />
                <Text style={styles.help}>{t('editorCover.help')}</Text>
                <View style={styles.field}>
                    <Text style={styles.label}>{t('editorCover.text')}</Text>
                    <TextInput accessibilityLabel={rawText(t('editorCover.text'))} value={text} onChangeText={setText} maxLength={120} placeholder={t('editorCover.textPlaceholder')}
                        placeholderTextColor={colors.muted} style={styles.input} returnKeyType="done" />
                </View>
                <View style={styles.field}>
                    <Text style={styles.label}>{t('editorCover.textColor')}</Text>
                    <View style={styles.swatches}>{COVER_SWATCHES.map(hex => <Pressable key={hex} accessibilityRole="button" accessibilityLabel={rawText(t('editorCover.color', { value1: hex }))}
                        accessibilityState={{ selected: textColor === hex }} onPress={() => setTextColor(hex)} style={[touchTarget, styles.swatchButton, textColor === hex && styles.swatchSelected]}>
                        <View style={[styles.swatch, { backgroundColor: hex }]} />
                    </Pressable>)}</View>
                </View>
                {text ? <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('editorCover.hideText'))} onPress={() => setText('')} style={[touchTarget, styles.hideText]}>
                    <Text style={styles.hideTextLabel}>{t('editorCover.hideText')}</Text>
                </Pressable> : null}
                <Text style={styles.frameReadout}>{t('editorCover.frameReadout', { value1: formatNumber(frame), value2: time(frame) })}</Text>
            </ScrollView>
        </KeyboardAvoidingView>
    </Modal>;
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
    title: { flex: 1, color: colors.text, fontFamily: fonts.display, fontSize: 19, textAlign: 'center' },
    headerAction: { minWidth: 66, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
    headerActionText: { color: colors.accent, fontSize: 16, fontWeight: '800' },
    content: { alignItems: 'stretch', gap: ds.space.lg, padding: ds.space.lg, paddingBottom: 42 },
    preview: { width: '100%', maxWidth: 560, maxHeight: 520, alignSelf: 'center', overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: '#050506' },
    coverText: { position: 'absolute', left: 24, right: 24, bottom: 28, fontFamily: fonts.displayHeavy, fontSize: 29, fontWeight: '900', textAlign: 'center', textShadowColor: 'rgba(0,0,0,.9)', textShadowRadius: 5 },
    frames: { flexDirection: 'row', gap: 8 },
    frameChoice: { flex: 1, minWidth: 0, gap: 4, padding: 3, borderWidth: 2, borderColor: 'transparent', borderRadius: 10, backgroundColor: colors.surface },
    frameSelected: { borderColor: colors.accent },
    framePreview: { height: 54, overflow: 'hidden', borderRadius: 7, backgroundColor: '#050506' },
    frameTime: { color: colors.muted, fontSize: 11, fontVariant: ['tabular-nums'], textAlign: 'center' },
    help: { color: colors.muted, fontSize: 13, lineHeight: 18, textAlign: 'center' },
    field: { gap: 8 }, label: { color: colors.text, fontSize: 16, fontWeight: '800' },
    input: { minHeight: 50, color: colors.text, fontSize: 16, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    swatchButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.border, borderRadius: 24 },
    swatchSelected: { borderColor: colors.accent }, swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong },
    hideText: { alignSelf: 'flex-start', justifyContent: 'center' }, hideTextLabel: { color: colors.accent, fontSize: 15, fontWeight: '800' },
    frameReadout: { color: colors.muted, fontSize: 12, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
