import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useOptionalSafeAreaInsets } from '../../lib/safeArea';
import { clipAt, splitClip, updateClip, type Clip, type Selection, type Timeline } from '../../lib/nativeEditorModel';
import { studioColors as colors, fonts } from '../../theme';
import { t } from '../../lib/i18n';

export function EditorTrimSheet({ visible, timeline, selection, playhead, onClose, onApply, canMove, onMove }: {
    visible: boolean;
    timeline: Timeline;
    selection: Selection | null;
    playhead: number;
    onClose(): void;
    onApply(next: Timeline): void;
    canMove?(direction: -1 | 1): boolean;
    onMove?(direction: -1 | 1): void;
}) {
    const insets = useOptionalSafeAreaInsets();
    const clip = useMemo(() => clipAt(timeline, selection) as Clip | undefined, [timeline, selection]);
    const media = clip?.mediaId ? timeline.media[clip.mediaId] : undefined;
    const [from, setFrom] = useState(clip?.in ?? 0), [length, setLength] = useState(clip?.len ?? 1);
    useEffect(() => { setFrom(clip?.in ?? 0); setLength(clip?.len ?? 1); }, [clip?.id, clip?.in, clip?.len, visible]);
    if (!clip || !selection) return null;
    const sourceFrames = Math.max(from + length, media?.frames ?? from + length);
    const maxLength = Math.max(1, sourceFrames - from);
    const fps = Math.max(1, timeline.fps);
    const display = (frames: number) => `${(frames / fps).toFixed(2)}s`;
    const adjustIn = (delta: number) => {
        const next = Math.max(0, Math.min(from + delta, sourceFrames - 1));
        setFrom(next); setLength(current => Math.min(current, sourceFrames - next));
    };
    const adjustOut = (delta: number) => setLength(current => Math.max(1, Math.min(maxLength, current + delta)));
    return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} accessibilityViewIsModal>
        <Pressable accessible={false} accessibilityRole="button" style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, {
            paddingBottom: Math.max(22, (insets?.bottom ?? 0) + 12),
            paddingLeft: Math.max(18, (insets?.left ?? 0) + 12),
            paddingRight: Math.max(18, (insets?.right ?? 0) + 12),
        }]}>
            <View style={styles.grabber} />
            <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel={t('editorParity.closeTrim')} onPress={onClose} style={styles.close}><Text style={styles.closeText}>{t('common.close')}</Text></Pressable><Text accessibilityRole="header" style={styles.title}>{t('editorSimple.trim')}</Text></View>
            {canMove && onMove ? <View style={styles.moveRow}>
                <Pressable accessibilityRole="button" accessibilityLabel={t('editorParity.moveLeft')} accessibilityState={{ disabled: !canMove(-1) }} disabled={!canMove(-1)}
                    onPress={() => onMove(-1)} style={({ pressed }) => [styles.moveButton, !canMove(-1) && styles.disabled, pressed && styles.pressed]}><Text style={styles.moveText}>{t('editorParity.moveLeft')}</Text></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={t('editorParity.moveRight')} accessibilityState={{ disabled: !canMove(1) }} disabled={!canMove(1)}
                    onPress={() => onMove(1)} style={({ pressed }) => [styles.moveButton, !canMove(1) && styles.disabled, pressed && styles.pressed]}><Text style={styles.moveText}>{t('editorParity.moveRight')}</Text></Pressable>
            </View> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={t('editorParity.splitAtPlayhead')} onPress={() => { const next = splitClip(timeline, selection, playhead); if (next) { onApply(next); onClose(); } }} style={styles.split}><Text style={styles.splitText}>{t('editorParity.splitAtPlayhead')}</Text></Pressable>
            <Stepper label={t('editorParity.inPoint')} value={display(from)} onMinus={() => adjustIn(-1)} onPlus={() => adjustIn(1)} />
            <Stepper label={t('editorParity.outPoint')} value={display(from + length)} onMinus={() => adjustOut(-1)} onPlus={() => adjustOut(1)} />
            <View style={styles.duration}><Text style={styles.durationLabel}>{t('editorParity.duration')}</Text><Text style={styles.durationValue}>{display(length)}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('editorParity.applyTrim')} onPress={() => { onApply(updateClip(timeline, selection, { in: from, len: length })); onClose(); }} style={styles.primary}><Text style={styles.primaryText}>{t('editorParity.applyTrim')}</Text></Pressable>
        </View>
    </Modal>;
}

function Stepper({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus(): void; onPlus(): void }) {
    return <View style={styles.stepper}><Text style={styles.stepperLabel}>{label}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('editorParity.decreaseValue', { name: label })} onPress={onMinus} style={styles.stepButton}><Text style={styles.stepButtonText}>−</Text></Pressable><Text style={styles.stepValue}>{value}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('editorParity.increaseValue', { name: label })} onPress={onPlus} style={styles.stepButton}><Text style={styles.stepButtonText}>+</Text></Pressable></View>;
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.58)' },
    sheet: { gap: 14, paddingHorizontal: 18, paddingTop: 10, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: '#303034', backgroundColor: '#1a1a1c' },
    grabber: { width: 42, height: 5, alignSelf: 'center', borderRadius: 3, backgroundColor: '#c7c3d4' },
    header: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    close: { position: 'absolute', start: 0, minWidth: 60, minHeight: 44, justifyContent: 'center' },
    closeText: { color: colors.accent, fontSize: 16, fontWeight: '700' },
    title: { color: colors.text, fontFamily: fonts.display, fontSize: 20 },
    split: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, borderWidth: 1, borderColor: colors.accent },
    splitText: { color: colors.accent, fontSize: 16, fontWeight: '800' },
    moveRow: { flexDirection: 'row', gap: 10 },
    moveButton: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23, backgroundColor: '#303034' },
    moveText: { color: colors.text, fontSize: 15, fontWeight: '800' },
    disabled: { opacity: 0.4 },
    pressed: { opacity: 0.65 },
    stepper: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#222225' },
    stepperLabel: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '800' },
    stepButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: '#303034' },
    stepButtonText: { color: colors.text, fontSize: 24, fontWeight: '700' },
    stepValue: { width: 70, color: colors.body, fontSize: 15, fontVariant: ['tabular-nums'], textAlign: 'center' },
    duration: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
    durationLabel: { color: colors.text, fontSize: 17, fontWeight: '800' },
    durationValue: { color: colors.body, fontSize: 16, fontVariant: ['tabular-nums'] },
    primary: { minHeight: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 29, backgroundColor: colors.accent },
    primaryText: { color: colors.accentInk, fontSize: 18, fontWeight: '900' },
});
