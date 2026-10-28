import { ActivityIndicator, View } from 'react-native';
import { Image } from 'expo-image';
import type { VideoThumbnail } from 'expo-video';
import { Text, Icon, Button, themedStyles, useThemedStyles } from '../ui';
import { GeneratedChip } from './GeneratedChip';
import { rowStatus, expiryOf } from '../../lib/libraryView';
import type { AssetLink } from '../../lib/libraryMedia';
import type { Job, Kind } from '../../lib/media';
import { t } from '../../lib/i18n';
export interface LibraryMediaProps {
    job: Job; kind?: Kind; link?: AssetLink; poster?: VideoThumbnail | null;
    audio?: { playing: boolean; toggle(): void };
}
export function LibraryMedia({ job, kind, link, poster, audio }: LibraryMediaProps) {
    const styles = useThemedStyles(sheets);
    const status = rowStatus(job);
    const held = status === 'held' || link?.kind === 'held';
    const file = !held && expiryOf(job).kind !== 'gone' && link?.kind === 'file' ? link : null;
    return <View style={styles.frame}>
        {held ? <><Text variant="caption" tone="secondary">{t('library.status.held')}</Text><Text variant="caption" tone="tertiary">{t('libraryCreate.heldBody')}</Text></>
            : status === 'creating' ? <ActivityIndicator />
            : file?.mime.startsWith('image/') ? <Image source={{ uri: file.url }} cachePolicy="memory" contentFit="cover" style={styles.fill} accessibilityLabel={t('job.title')} />
            : file?.mime.startsWith('video/') ? <>{poster ? <Image source={poster} cachePolicy="memory" contentFit="cover" style={styles.fill} /> : <Icon name="video" />}<View style={styles.play}><Icon name="play" /></View></>
            : <><Icon name={file?.mime.startsWith('audio/') ? 'audio' : kind ?? 'image'} tint={status === 'failed' || status === 'refunded' ? styles.danger.color : styles.dim.color} />
                {file?.mime.startsWith('audio/') && audio ? <Button variant="secondary" icon={audio.playing ? undefined : 'play'} label={t(audio.playing ? 'cinemaUpload.pause' : 'cinemaBrowse.play')} onPress={event => { event.stopPropagation(); audio.toggle(); }} /> : null}</>}
        {file ? <GeneratedChip /> : null}
    </View>;
}
const sheets = themedStyles(p => ({
    frame: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: p.bgElevated2, overflow: 'hidden', borderRadius: 8 },
    fill: { width: '100%', height: '100%' }, play: { position: 'absolute', bottom: 8, end: 8, padding: 6, borderRadius: 20, backgroundColor: p.bgElevated1 },
    danger: { color: p.danger }, dim: { color: p.textTertiary },
}));
