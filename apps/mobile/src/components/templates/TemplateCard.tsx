import { useEffect } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Button, Card, Text, themedStyles, useThemedStyles } from '../ui';
import type { Preset } from '../../lib/presets';
import { previewRatio, templatePrice } from '../../lib/templateFilters';
import { t } from '../../lib/i18n';
export function TemplateCard({ preset, playing, onPlay, onOpen }: { preset: Preset; playing: boolean; onPlay(): void; onOpen(): void }) {
    const styles = useThemedStyles(sheets);
    return <Card style={styles.card}>
        <Card onPress={onOpen} accessibilityRole="button" accessibilityLabel={preset.title} style={styles.open}>
            <View style={[styles.preview, { aspectRatio: previewRatio(preset) }]}>
                {playing && preset.previewUrl ? <Preview url={preset.previewUrl} /> : preset.posterUrl ? <Image source={{ uri: preset.posterUrl }} contentFit="cover" cachePolicy="memory" style={styles.fill} /> : null}
                {preset.isNew ? <View style={styles.badge}><Text variant="caption">{t('explore.new')}</Text></View> : null}
            </View>
            <Text variant="bodyStrong">{preset.title}</Text><Text variant="caption" tone="secondary">{preset.modelName}</Text><Text tone="warning">{templatePrice(preset)}</Text>
            {!preset.available ? <Text tone="secondary">{t('presets.notavailablerightnow')}</Text> : null}
        </Card>
        {preset.previewUrl ? <Button variant="secondary" label={t(playing ? 'cinemaUpload.pause' : 'cinemaBrowse.play')} icon={playing ? undefined : 'play'} onPress={onPlay} /> : null}
    </Card>;
}
function Preview({ url }: { url: string }) {
    const styles = useThemedStyles(sheets);
    const player = useVideoPlayer(url, p => { p.muted = true; p.loop = true; });
    // This component is mounted only by a deliberate Play tap. Unmounting stops the sole preview.
    useEffect(() => { player.play(); return () => player.pause(); }, [player]);
    return <VideoView player={player} nativeControls={false} contentFit="cover" style={styles.fill} accessibilityLabel={t('job.playVideo')} />;
}
const sheets = themedStyles(p => ({
    card: { flex: 1, margin: 4, padding: 8, gap: 8 }, open: { borderWidth: 0, padding: 0, gap: 4 },
    preview: { width: '100%', overflow: 'hidden', borderRadius: 8, backgroundColor: p.bgElevated2 }, fill: { width: '100%', height: '100%' },
    badge: { position: 'absolute', top: 8, start: 8, backgroundColor: p.bgElevated1, borderRadius: 8, padding: 4 },
}));
