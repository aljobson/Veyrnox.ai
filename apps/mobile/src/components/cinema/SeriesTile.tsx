import { rawText } from '../../lib/i18n/translate';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CinemaPosterImage } from './CinemaPosterImage';
import type { DiscoveryTitle } from '../../lib/cinemaBrowse';
import type { EditorialSeries } from '../../lib/cinemaSeries';
import { plural, t } from '../../lib/i18n';
import { MIN_TARGET } from '../../lib/a11y';
import { colors } from '../../theme';

interface Props {
    readonly item: DiscoveryTitle | EditorialSeries;
    readonly width: number;
    readonly onOpen: () => void;
}

// One Series tile: a poster, the title, the creator and one meta line (episodes, or the running time).
export function SeriesTile({ item, width, onOpen }: Props) {
    const editorial = 'slug' in item;
    const creator = editorial ? item.creatorName : item.creator;
    const meta = tileMeta(item);
    const by = creator ? t('cinemaSeries.by', { creator }) : '';
    const label = [by, meta].filter(Boolean).join(' · ');
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={rawText(label ? `${item.title}. ${label}` : item.title)} style={[styles.tile, { width }]} onPress={onOpen}>
            {editorial
                ? <Image source={{ uri: item.posterUrl }} style={styles.poster} contentFit="cover" accessible={false} accessibilityIgnoresInvertColors />
                : <View style={styles.posterBox}><CinemaPosterImage id={item.id} /></View>}
            <View style={styles.body}>
                <Text style={styles.name} numberOfLines={2}>{item.title}</Text>
                {by ? <Text style={styles.muted} numberOfLines={1}>{by}</Text> : null}
                {meta ? <Text style={styles.meta} numberOfLines={1}>{meta}</Text> : null}
            </View>
        </Pressable>
    );
}

function tileMeta(item: DiscoveryTitle | EditorialSeries): string {
    if ('slug' in item) return plural('cinemaBrowse.episodes', item.episodes.length);
    if (item.contentType === 'SERIES') return plural('cinemaBrowse.episodes', item.episodeCount);
    if (item.durationSeconds === null) return '';
    return t('cinema.duration', { n: Math.max(1, Math.round(item.durationSeconds / 60)) });
}

const styles = StyleSheet.create({
    tile: { minHeight: MIN_TARGET, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
    poster: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.border },
    posterBox: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.border },
    body: { padding: 8, gap: 2 },
    name: { color: colors.text, fontSize: 15, fontWeight: '700' },
    muted: { color: colors.muted, fontSize: 13 },
    meta: { color: colors.muted, fontSize: 12 },
});
