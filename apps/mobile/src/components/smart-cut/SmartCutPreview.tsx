import { rawText } from '../../lib/i18n/translate';
import { useEffect } from 'react';
import { Modal, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Button, Card, Text, themedStyles, useThemedStyles } from '../ui';
import { ds } from '../../theme';
import { t } from '../../lib/i18n';

export function SmartCutPreview({ url, label, start, end, onClose }: { readonly url: string; readonly label: string; readonly start: number; readonly end: number; readonly onClose: () => void }) {
    const styles = useThemedStyles(sheets);
    const player = useVideoPlayer(url, instance => {
        instance.muted = true;
        instance.loop = false;
        instance.timeUpdateEventInterval = 0.1;
    });
    useEffect(() => {
        if (player.status === 'readyToPlay') player.currentTime = start;
        const ready = player.addListener('statusChange', ({ status }) => {
            if (status === 'readyToPlay') player.currentTime = start;
        });
        const playing = player.addListener('playingChange', ({ isPlaying }) => {
            if (isPlaying && (player.currentTime < start || player.currentTime >= end)) player.currentTime = start;
        });
        const time = player.addListener('timeUpdate', ({ currentTime }) => {
            if (currentTime >= end) player.pause();
        });
        return () => { ready.remove(); playing.remove(); time.remove(); player.pause(); };
    }, [end, player, start]);
    return (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <View style={styles.screen} onAccessibilityEscape={onClose}>
                <View style={styles.header}>
                    <View style={styles.copy}>
                        <Text variant="title2" accessibilityRole="header" numberOfLines={1}>{label}</Text>
                        <Text variant="footnote" tone="secondary">{t('app.smartCut.range', { start: start.toFixed(1), end: end.toFixed(1) })}</Text>
                    </View>
                    <Button label={t('oddlings.build.done')} variant="tertiary" size="md" onPress={onClose} />
                </View>
                <Card style={styles.playerCard}>
                    <VideoView player={player} nativeControls contentFit="contain" accessibilityLabel={rawText(t('app.smartCut.preview', { name: label }))} style={styles.player} />
                </Card>
            </View>
        </Modal>
    );
}

const sheets = themedStyles((p) => ({
    screen: { flex: 1, padding: ds.space.lg, gap: ds.space.md, backgroundColor: p.bg },
    header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ds.space.md },
    copy: { flex: 1, gap: ds.space.xs },
    playerCard: { padding: 0, overflow: 'hidden', backgroundColor: '#000000' },
    player: { width: '100%', aspectRatio: 16 / 9, minHeight: 220, backgroundColor: '#000000' },
}));
