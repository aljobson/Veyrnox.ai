import { View } from 'react-native';
import { type Episode, type TitleDetail, formatDuration } from '../../lib/cinema';
import { type LockReason } from '../../lib/cinemaBrowse';
import { accessLabel } from '../../lib/cinemaViewer';
import { t } from '../../lib/i18n';
import { Card, Chip, Text } from '../ui';

export function SeasonList({ detail, episodes, locks, detailLocks, onWatch }: {
    detail: TitleDetail; episodes: readonly Episode[]; locks: ReadonlyMap<string, LockReason | null>;
    detailLocks: ReadonlyMap<string, LockReason | null>; onWatch: (episode: Episode) => void;
}) {
    return <>{detail.seasons.map((season, index) => <View key={season.id || index} style={{ gap: 8 }}>
        <Text variant="title3" accessibilityRole="header">{t('cinema.title.season', { number: season.position })}</Text>
        {season.title && season.title !== detail.title.title ? <Text>{season.title}</Text> : null}
        {season.episodes.map(raw => {
            const episode = episodes.find(e => e.id === raw.id)!;
            const label = accessLabel(episode);
            const lock = locks.get(episode.id) ?? detailLocks.get(episode.id);
            return <Card key={episode.id} accessibilityLabel={episode.title} accessibilityState={{ disabled: !episode.watchable }}
                disabled={!episode.watchable} onPress={() => onWatch(episode)} style={{ gap: 4, opacity: episode.watchable ? 1 : 0.5 }}>
                <Text variant="micro">{t('cinemaViewer.episodeNumber', { number: episode.position })}</Text>
                <Text variant="bodyStrong">{episode.title}</Text>
                {episode.synopsis ? <Text numberOfLines={2}>{episode.synopsis}</Text> : null}
                <Text variant="caption" tone="secondary">{formatDuration(episode.durationSeconds)}</Text>
                {episode.watchable ? label ? <Chip label={label} /> : null : <Text tone="secondary">{t(lock === 'free_ceiling' ? 'cinemaSeries.state.free_ceiling' : lock === 'paid' ? 'cinemaSeries.state.paid' : 'cinemaSeries.state.locked')}</Text>}
            </Card>;
        })}
    </View>)}</>;
}
