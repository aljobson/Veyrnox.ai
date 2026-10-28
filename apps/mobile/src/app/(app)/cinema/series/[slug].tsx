import { rawText } from '../../../../lib/i18n/translate';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ComingToApp } from '../../../../components/ComingToApp';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../../../../lib/a11y';
import { formatDuration } from '../../../../lib/cinema';
import { editorialSeriesBySlug } from '../../../../lib/cinemaSeries';
import { plural, t } from '../../../../lib/i18n';
import { colors, fonts } from '../../../../theme';

export default function EditorialSeriesPage() {
    const { slug } = useLocalSearchParams<{ slug: string }>();
    const router = useRouter();
    const series = editorialSeriesBySlug(slug);
    if (!series) return (
        <View style={styles.content}>
            <Text style={styles.body}>{t('cinemaSeries.unavailable')}</Text>
            <Pressable accessibilityRole="link" style={touchTarget} onPress={() => router.replace('/cinema')}>
                <Text style={styles.link}>{t('cinemaSeries.back')}</Text>
            </Pressable>
        </View>
    );
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: series.title }} />
            <Image source={{ uri: series.posterUrl }} style={styles.poster} contentFit="cover" accessibilityLabel={rawText(t('cinemaSeries.poster', { title: series.title }))} accessibilityIgnoresInvertColors />
            <Text style={styles.title} accessibilityRole="header">{series.title}</Text>
            <Text style={styles.muted}>{plural('cinemaSeries.season', series.episodes.length, { season: series.season, title: series.seasonTitle, n: series.episodes.length })}</Text>
            <Text style={styles.body}>{series.description}</Text>
            <Text style={styles.muted}>{t('cinemaSeries.creator', { creator: series.creatorName, source: series.sourceName })}</Text>
            <ComingToApp />
            <Text style={styles.title} accessibilityRole="header">{t('cinemaSeries.episodes')}</Text>
            {series.episodes.map(episode => (
                <View key={episode.id} style={styles.episode}>
                    <Text style={styles.muted}>{t('cinemaSeries.episode', { position: episode.position, duration: formatDuration(episode.durationSeconds) })}</Text>
                    <Text style={styles.body}>{episode.title}</Text>
                </View>
            ))}
        </ScrollView>
    );
}
const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 12 },
    poster: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: colors.surface },
    title: { color: colors.text, fontFamily: fonts.display, fontSize: 24 },
    body: { color: colors.body, fontSize: 16 },
    muted: { color: colors.muted },
    link: { color: colors.accent },
    play: { ...touchTarget, padding: 14, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center' },
    playText: { color: colors.accentInk, fontSize: 16, fontWeight: '700' },
    episode: { ...touchTarget, padding: 14, gap: 6, borderRadius: 12, backgroundColor: colors.surface },
    error: { color: colors.danger },
});
