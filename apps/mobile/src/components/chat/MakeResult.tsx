import { rawText } from '../../lib/i18n/translate';
import { Image } from 'expo-image';
import { View } from 'react-native';
import { t } from '../../lib/i18n';
import type { MakeJob } from '../../lib/useMakePanelState';
import { InlineMedia } from '../InlineMedia';
import { Button, Card, Text, themedStyles, useThemedStyles } from '../ui';

export function MakeResult({ jobs, count, canMakeAnother, onOpen, onLibrary, onMakeAnother }: {
    jobs: readonly MakeJob[]; count: number; canMakeAnother: boolean;
    onOpen: (id: string) => void; onLibrary: () => void; onMakeAnother: () => void;
}) {
    const styles = useThemedStyles(sheets);
    if (!jobs.length) return null;
    return <View style={styles.section}>
        <View style={styles.grid}>
            {jobs.map(job => <Card key={job.id} style={[styles.card, count > 1 && styles.tile]}>
                <Text accessibilityLiveRegion="polite">{t(`job.${job.state}`)}</Text>
                {job.asset?.mime_type.startsWith('image/') ? <Image source={{ uri: job.asset.url }} contentFit="cover" accessibilityLabel={t('job.title')} style={styles.image} /> : null}
                {job.asset && /^(video|audio)\//.test(job.asset.mime_type) ? <InlineMedia url={job.asset.url} audio={job.asset.mime_type.startsWith('audio/')} label={t(job.asset.mime_type.startsWith('audio/') ? 'job.playAudio' : 'job.playVideo')} /> : null}
                <Button variant="secondary" label={t('chatDepth.wfOpen')} accessibilityLabel={rawText(`${t('chatDepth.wfOpen')}: ${t('job.title')}`)} onPress={() => onOpen(job.id)} />
            </Card>)}
        </View>
        {jobs.some(job => job.state === 'queued' || job.state === 'running') ? <Text variant="footnote" tone="secondary">{t('job.keepsRunning')}</Text> : null}
        <Button variant="secondary" label={t('faceFilters.openLibrary')} onPress={onLibrary} />
        <Button variant="secondary" label={t('job.next.makeAnother')} disabled={!canMakeAnother} onPress={onMakeAnother} />
    </View>;
}
const sheets = themedStyles(() => ({
    section: { gap: 12 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: '4%', rowGap: 12 },
    card: { width: '100%', gap: 8 },
    tile: { width: '48%' },
    image: { width: '100%', aspectRatio: 1 },
}));
