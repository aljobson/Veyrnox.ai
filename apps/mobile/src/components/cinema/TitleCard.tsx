import { Image } from 'expo-image';
import { StyleSheet, Pressable, Text, View } from 'react-native';
import { formatDuration, posterUrl, type CinemaTitle } from '../../lib/cinema';
import { colors } from '../../theme';
import { CinemaPlayer } from './CinemaPlayer';

interface Props {
    readonly item: CinemaTitle;
    readonly height: number;
    readonly playing: boolean;
    readonly onPlay: () => void;
    readonly onOpen: () => void;
    readonly onReport: () => void;
}

// One full-screen page of the feed: the poster until the viewer presses Play, then the one live player.
export function TitleCard({ item, height, playing, onPlay, onOpen, onReport }: Props) {
    const series = item.contentType === 'SERIES';
    const meta = series
        ? `${item.episodeCount} episode${item.episodeCount === 1 ? '' : 's'}`
        : formatDuration(item.durationSeconds);
    return (
        <View style={[styles.page, { height }]}>
            {playing ? (
                <CinemaPlayer contentId={item.id} />
            ) : (
                <>
                    <Image source={{ uri: posterUrl(item.id) }} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} accessibilityIgnoresInvertColors />
                    <View style={styles.shade} />
                </>
            )}
            <View style={styles.info} pointerEvents="box-none">
                <Pressable accessibilityRole="button" accessibilityHint="Opens the title page" onPress={onOpen}>
                    <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                    <Text style={styles.meta}>{[item.creator, meta].filter(Boolean).join(' · ')}</Text>
                    {!playing && item.synopsis ? <Text style={styles.synopsis} numberOfLines={2}>{item.synopsis}</Text> : null}
                </Pressable>
                <View style={styles.actions}>
                    {!playing ? (
                        <Pressable accessibilityRole="button" style={styles.play} onPress={series ? onOpen : onPlay}>
                            <Text style={styles.playText}>{series ? 'Episodes' : 'Play'}</Text>
                        </Pressable>
                    ) : null}
                    <Pressable accessibilityRole="button" accessibilityLabel={`Report ${item.title}`} style={styles.report} onPress={onReport}>
                        <Text style={styles.reportText}>Report</Text>
                    </Pressable>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    page: { backgroundColor: colors.background, justifyContent: 'flex-end' },
    shade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(10,10,11,0.45)' },
    info: { padding: 16, paddingBottom: 28, gap: 12 },
    title: { color: colors.text, fontSize: 22, fontWeight: '700' },
    meta: { color: colors.body, marginTop: 2 },
    synopsis: { color: colors.body, marginTop: 6 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    play: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 },
    playText: { color: colors.accentInk, fontSize: 16, fontWeight: '700' },
    report: { minHeight: 44, justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 12 },
    reportText: { color: colors.muted, fontSize: 14 },
});
