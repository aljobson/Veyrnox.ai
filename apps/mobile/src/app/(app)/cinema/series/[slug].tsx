import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../../../../lib/a11y';
import { formatDuration } from '../../../../lib/cinema';
import { editorialEpisodeWebUrl, editorialSeriesBySlug } from '../../../../lib/cinemaSeries';
import { plural, t } from '../../../../lib/i18n';
import { colors } from '../../../../theme';

export default function EditorialSeriesPage() {
    const { slug } = useLocalSearchParams<{ slug: string }>();
    const router = useRouter();
    const series = editorialSeriesBySlug(slug);
    const [openFailed, setOpenFailed] = useState(false);
    if (!series) return (
        <View style={styles.content}>
            <Text style={styles.body}>{t('cinemaSeries.unavailable')}</Text>
            <Pressable accessibilityRole="link" style={touchTarget} onPress={() => router.replace('/cinema')}>
                <Text style={styles.link}>{t('cinemaSeries.back')}</Text>
            </Pressable>
        </View>
    );
    const open = async (episodeId: string) => {
        const url = editorialEpisodeWebUrl(series.slug, episodeId);
        if (!url) return;
        setOpenFailed(false);
        try { await WebBrowser.openBrowserAsync(url); }
        catch { setOpenFailed(true); }
    };
    const first = series.episodes[0];
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: series.title }} />
            <Image source={{ uri: series.posterUrl }} style={styles.poster} contentFit="cover" accessibilityLabel={t('cinemaSeries.poster', { title: series.title })} accessibilityIgnoresInvertColors />
            <Text style={styles.title} accessibilityRole="header">{series.title}</Text>
            <Text style={styles.muted}>{plural('cinemaSeries.season', series.episodes.length, { season: series.season, title: series.seasonTitle, n: series.episodes.length })}</Text>
            <Text style={styles.body}>{series.description}</Text>
            <Text style={styles.muted}>{t('cinemaSeries.creator', { creator: series.creatorName, source: series.sourceName })}</Text>
            <Text style={styles.muted}>{t('cinemaSeries.browserNote')}</Text>
            <Pressable accessibilityRole="link" style={styles.play} onPress={() => open(first.id)}>
                <Text style={styles.playText}>{t('cinemaSeries.playFirst')}</Text>
            </Pressable>
            {openFailed ? <Text style={styles.error} accessibilityRole="alert">{t('cinemaSeries.openFailed')}</Text> : null}
            <Text style={styles.title} accessibilityRole="header">{t('cinemaSeries.episodes')}</Text>
            {series.episodes.map(episode => (
                <Pressable key={episode.id} accessibilityRole="link" accessibilityLabel={t('cinemaSeries.watchLabel', { position: episode.position, title: episode.title })} style={styles.episode} onPress={() => open(episode.id)}>
                    <Text style={styles.muted}>{t('cinemaSeries.episode', { position: episode.position, duration: formatDuration(episode.durationSeconds) })}</Text>
                    <Text style={styles.body}>{episode.title}</Text>
                </Pressable>
            ))}
        </ScrollView>
    );
}
const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 12 },
    poster: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: colors.surface },
    title: { color: colors.text, fontSize: 24, fontWeight: '700' },
    body: { color: colors.body, fontSize: 16 },
    muted: { color: colors.muted },
    link: { color: colors.accent },
    play: { ...touchTarget, padding: 14, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center' },
    playText: { color: colors.accentInk, fontSize: 16, fontWeight: '700' },
    episode: { ...touchTarget, padding: 14, gap: 6, borderRadius: 12, backgroundColor: colors.surface },
    error: { color: colors.danger },
});
