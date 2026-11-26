import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useOptionalSafeAreaInsets } from '../../lib/safeArea';
import type { Clip } from '../../lib/nativeEditorModel';
import { studioColors as colors, fonts } from '../../theme';
import { Slider } from './tools/Slider';

export function EditorClipAudioSheet({ visible, clip, fps, focus, onClose, onPatch }: {
    visible: boolean;
    clip: Clip | null;
    fps: number;
    focus: 'volume' | 'fade';
    onClose(): void;
    onPatch(patch: Partial<Clip>): void;
}) {
    const insets = useOptionalSafeAreaInsets();
    if (!clip) return null;
    const seconds = (frames: number) => `${(frames / Math.max(1, fps)).toFixed(1)}s`;
    return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} accessibilityViewIsModal>
        <Pressable accessible={false} style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(24, (insets?.bottom ?? 0) + 14) }]}>
            <View style={styles.grabber} />
            <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Close clip sound" onPress={onClose} style={styles.close}><Text style={styles.closeText}>Close</Text></Pressable><Text accessibilityRole="header" style={styles.title}>{focus === 'volume' ? 'Volume' : 'Fade'}</Text></View>
            <Slider label="Volume" value={clip.volume ?? 1} min={0} max={2} step={.05} format={value => `${Math.round(value * 100)}%`} onChange={volume => onPatch({ volume })} />
            <Slider label="Fade in" value={clip.fadeIn ?? 0} min={0} max={Math.max(1, Math.floor(clip.len / 2))} step={1} format={seconds} onChange={fadeIn => onPatch({ fadeIn })} />
            <Slider label="Fade out" value={clip.fadeOut ?? 0} min={0} max={Math.max(1, Math.floor(clip.len / 2))} step={1} format={seconds} onChange={fadeOut => onPatch({ fadeOut })} />
            <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={onClose} style={styles.primary}><Text style={styles.primaryText}>Done</Text></Pressable>
        </View>
    </Modal>;
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.58)' },
    sheet: { gap: 18, paddingHorizontal: 20, paddingTop: 10, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: '#303034', backgroundColor: '#1a1a1c' },
    grabber: { width: 42, height: 5, alignSelf: 'center', borderRadius: 3, backgroundColor: '#c7c3d4' },
    header: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    close: { position: 'absolute', start: 0, minWidth: 60, minHeight: 44, justifyContent: 'center' },
    closeText: { color: colors.accent, fontSize: 16, fontWeight: '700' },
    title: { color: colors.text, fontFamily: fonts.display, fontSize: 20 },
    primary: { minHeight: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 29, backgroundColor: colors.accent },
    primaryText: { color: colors.accentInk, fontSize: 18, fontWeight: '900' },
});
