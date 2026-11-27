import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { AUDIO_DEFAULTS } from '../../lib/editorAudioEdit';
import { useOptionalSafeAreaInsets } from '../../lib/safeArea';
import { studioColors as colors, fonts } from '../../theme';
import type { Clip } from '../../lib/nativeEditorModel';
import type { AudioSettingsActions } from './tools/useAudioSettingsActions';
import { Slider } from './tools/Slider';
import { t } from '../../lib/i18n';

export function EditorCleanVoiceSheet({ visible, clip, available, actions, onClose }: {
    visible: boolean;
    clip: Clip | null;
    available: boolean;
    actions: AudioSettingsActions;
    onClose(): void;
}) {
    const insets = useOptionalSafeAreaInsets();
    const initial = { ...AUDIO_DEFAULTS, ...clip?.audioProcessing };
    const [enabled, setEnabled] = useState(initial.noiseReduction > 0 || initial.gateDb > -96);
    const [strength, setStrength] = useState(initial.noiseReduction > 0 ? initial.noiseReduction : .65);
    useEffect(() => {
        const next = { ...AUDIO_DEFAULTS, ...clip?.audioProcessing };
        setEnabled(next.noiseReduction > 0 || next.gateDb > -96);
        setStrength(next.noiseReduction > 0 ? next.noiseReduction : .65);
    }, [clip?.id, clip?.audioProcessing?.noiseReduction, clip?.audioProcessing?.gateDb, visible]);
    const apply = () => {
        if (!available || !clip) return;
        const current = { ...AUDIO_DEFAULTS, ...clip.audioProcessing };
        actions.patch({ audioProcessing: {
            ...current,
            noiseReduction: enabled ? strength : 0,
            gateDb: enabled ? -42 : AUDIO_DEFAULTS.gateDb,
        } });
        onClose();
    };
    return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} accessibilityViewIsModal>
        <Pressable accessible={false} accessibilityRole="button" style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, {
            paddingBottom: Math.max(24, (insets?.bottom ?? 0) + 14),
            paddingLeft: Math.max(20, (insets?.left ?? 0) + 12),
            paddingRight: Math.max(20, (insets?.right ?? 0) + 12),
        }]}>
            <View style={styles.grabber} />
            <View style={styles.header}>
                <Pressable accessibilityRole="button" accessibilityLabel={t('editorParity.closeCleanVoice')} onPress={onClose} style={styles.close}><Text style={styles.closeText}>{t('common.close')}</Text></Pressable>
                <Text accessibilityRole="header" style={styles.title}>{t('editorSimple.cleanVoice')}</Text>
            </View>
            <Text style={styles.copy}>{t('editorParity.cleanVoiceDescription')}</Text>
            {available && clip ? <>
                <View style={styles.toggleRow}>
                    <View style={styles.toggleCopy}><Text style={styles.toggleTitle}>{t('editorParity.cleanUpVoice')}</Text><Text style={styles.toggleHint}>{t('editorParity.keepsVoiceNatural')}</Text></View>
                    <Switch accessibilityLabel={t('editorParity.cleanUpVoice')} value={enabled} onValueChange={setEnabled} trackColor={{ false: '#45454b', true: colors.accentSoft }} thumbColor={enabled ? colors.accent : '#d6d6da'} />
                </View>
                <Slider label={t('editorParity.strength')} value={strength} min={.15} max={1} step={.05} disabled={!enabled} format={value => `${Math.round(value * 100)}%`} onChange={setStrength} />
                <Pressable accessibilityRole="button" accessibilityLabel={t('editorParity.applyCleanVoice')} onPress={apply} style={styles.primary}><Text style={styles.primaryText}>{t('editorParity.applyCleanVoice')}</Text></Pressable>
            </> : <>
                <View style={styles.empty}><Text style={styles.emptyTitle}>{t('editorParity.selectVoiceClip')}</Text><Text style={styles.emptyBody}>{t('editorParity.selectVoiceClipHelp')}</Text></View>
                <Pressable accessibilityRole="button" accessibilityLabel={t('editorSimple.done')} onPress={onClose} style={styles.primary}><Text style={styles.primaryText}>{t('editorSimple.done')}</Text></Pressable>
            </>}
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
    copy: { color: colors.body, fontSize: 15, lineHeight: 22, textAlign: 'center' },
    toggleRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, borderRadius: 18, backgroundColor: '#232326' },
    toggleCopy: { flex: 1, gap: 4 },
    toggleTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
    toggleHint: { color: colors.muted, fontSize: 14 },
    empty: { gap: 6, padding: 18, borderRadius: 18, backgroundColor: '#232326' },
    emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '800', textAlign: 'center' },
    emptyBody: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
    primary: { minHeight: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 29, backgroundColor: colors.accent },
    primaryText: { color: colors.accentInk, fontSize: 18, fontWeight: '900' },
});
