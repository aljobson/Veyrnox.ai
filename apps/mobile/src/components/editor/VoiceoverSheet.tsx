import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { t } from '../../lib/i18n';
import { clock, meterLevel } from '../../lib/editorVoiceover';
import { colors } from '../../theme';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Text } from '../ui/Text';
import { useVoiceoverRecorder, type VoiceoverProps } from './useVoiceoverRecorder';

export function VoiceoverSheet({ ready, ...props }: Omit<VoiceoverProps, 'active'> & { ready: boolean }) {
    const state = useVoiceoverRecorder({ ...props, active: ready });
    const review = state.phase === 'review', recording = state.phase === 'recording';
    const busy = state.phase === 'asking' || state.phase === 'starting' || state.phase === 'adding' || state.stopping;
    return <Modal visible={ready} transparent animationType="none" accessibilityViewIsModal onRequestClose={() => void state.close()}>
        <View style={styles.backdrop}><Card style={styles.sheet}><ScrollView contentContainerStyle={styles.content}>
            <Text accessibilityRole="header" variant="title2">{t('editorVoiceover.title')}</Text>
            <Text>{t('editorVoiceover.help')}</Text>
            {recording ? <>
                <Text>{t('editorVoiceover.recording', { time: clock(state.elapsed), limit: clock(state.limit) })}</Text>
                <View testID="voiceover-meter" style={styles.meter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={[styles.level, { width: `${meterLevel(state.metering) * 100}%` }]} /></View>
            </> : null}
            {state.message ? <Text>{state.message}</Text> : null}
            {!state.take && !recording ? <Button label={t('editorVoiceover.record')} disabled={busy || !ready} onPress={() => void state.start()} /> : null}
            {recording ? <Button label={t('editorVoiceover.stop')} onPress={() => void state.stop()} /> : null}
            {state.take ? <>
                <Button label={state.playing ? t('editorVoiceover.pause') : t('editorVoiceover.play')} disabled={!review || !ready} onPress={() => void state.togglePlayback()} />
                <Button label={t('editorVoiceover.rerecord')} disabled={!review || !ready} onPress={() => void state.start()} />
                <Button label={t('editorVoiceover.add')} disabled={!review || !ready} onPress={() => void state.add()} />
                <Button label={t('editorVoiceover.discard')} variant="destructive" disabled={busy} onPress={state.discard} />
            </> : null}
            <Button label={t('editorVoiceover.close')} variant="secondary" disabled={state.phase === 'adding'} onPress={() => void state.close()} />
        </ScrollView></Card></View>
    </Modal>;
}
const styles = StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' },
    sheet: { maxHeight: '90%' }, content: { gap: 12 },
    meter: { height: 8, backgroundColor: colors.muted }, level: { height: 8, backgroundColor: colors.accent },
});
