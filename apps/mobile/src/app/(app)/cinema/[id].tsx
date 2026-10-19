import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { blockMember, blocksErrorKey } from '../../../lib/cinemaBlocks';
import { t } from '../../../lib/i18n';
import { formatDuration, parseTitleDetail, posterUrl, type TitleDetail } from '../../../lib/cinema';
import { colors } from '../../../theme';

export default function CinemaTitlePage() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { api } = useAuth();
    const router = useRouter();
    const [detail, setDetail] = useState<TitleDetail | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let live = true;
        api.request<unknown>(`/api/v1/cinema/titles/${encodeURIComponent(id)}`)
            .then((body) => {
                const parsed = parseTitleDetail(body);
                if (!live) return;
                if (parsed) setDetail(parsed);
                else setFailed(true);
            })
            .catch(() => live && setFailed(true));
        return () => { live = false; };
    }, [api, id]);

    const watch = (contentId: string, title: string) => router.push({ pathname: '/cinema/watch/[id]', params: { id: contentId, title } });
    const report = () => router.push({ pathname: '/report', params: { kind: 'cinema_title', id } });
    const [blocking, setBlocking] = useState(false);
    const [blockNote, setBlockNote] = useState<string | null>(null);
    // Blocking hides this member's titles and comments from this person only; it does not tell them. Reporting is separate.
    const block = () => {
        const username = detail?.title.creatorUsername;
        const name = detail?.title.creator || username;
        if (!username || !name) return;
        Alert.alert(t('blocks.blockTitle', { name }), t('blocks.blockBody'), [
            { text: t('blocks.cancel'), style: 'cancel' },
            {
                text: t('blocks.block'),
                style: 'destructive',
                onPress: async () => {
                    setBlocking(true);
                    setBlockNote(null);
                    try {
                        await blockMember(api, username);
                        router.back();
                    } catch (err) {
                        setBlockNote(t(blocksErrorKey(err)));
                        setBlocking(false);
                    }
                },
            },
        ]);
    };

    if (failed) return <View style={styles.center}><Text style={styles.muted}>This title is not available.</Text></View>;
    if (!detail) return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;

    const { title } = detail;
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: title.title }} />
            <Image source={{ uri: posterUrl(title.id) }} style={styles.poster} contentFit="cover" accessibilityLabel={`Poster for ${title.title}`} accessibilityIgnoresInvertColors />
            <Text style={styles.title} accessibilityRole="header">{title.title}</Text>
            {title.creator ? <Text style={styles.muted}>{title.creator}</Text> : null}
            {title.synopsis ? <Text style={styles.body}>{title.synopsis}</Text> : null}
            {title.contentType !== 'SERIES' ? (
                detail.watchable ? (
                    <Pressable accessibilityRole="button" style={styles.play} onPress={() => watch(title.id, title.title)}>
                        <Text style={styles.playText}>Play</Text>
                    </Pressable>
                ) : (
                    <Text style={styles.muted}>This title is not available to watch in the app yet.</Text>
                )
            ) : (
                detail.episodes.map((e) => (
                    <Pressable
                        key={e.id}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !e.watchable }}
                        disabled={!e.watchable}
                        style={[styles.row, !e.watchable && styles.rowOff]}
                        onPress={() => watch(e.id, e.title)}
                    >
                        <Text style={styles.rowTitle} numberOfLines={1}>S{e.season} E{e.position} · {e.title}</Text>
                        <Text style={styles.muted}>{e.watchable ? formatDuration(e.durationSeconds) : 'Not available yet'}</Text>
                    </Pressable>
                ))
            )}
            <Pressable accessibilityRole="button" style={styles.report} onPress={report}>
                <Text style={styles.muted}>Report this title</Text>
            </Pressable>
            {title.creatorUsername ? (
                <Pressable accessibilityRole="button" accessibilityState={{ busy: blocking, disabled: blocking }} disabled={blocking} style={styles.report} onPress={block}>
                    <Text style={styles.muted}>{t('blocks.blockMember', { name: title.creator || title.creatorUsername })}</Text>
                </Pressable>
            ) : null}
            {blockNote ? <Text style={styles.muted} accessibilityRole="alert">{blockNote}</Text> : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 10 },
    center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
    poster: { width: '100%', aspectRatio: 9 / 16, maxHeight: 420, borderRadius: 12, backgroundColor: colors.surface },
    title: { color: colors.text, fontSize: 24, fontWeight: '700' },
    body: { color: colors.body, fontSize: 16 },
    muted: { color: colors.muted },
    play: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    playText: { color: colors.accentInk, fontSize: 16, fontWeight: '700' },
    row: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 2 },
    rowOff: { opacity: 0.5 },
    rowTitle: { color: colors.text, fontSize: 16 },
    report: { minHeight: 44, justifyContent: 'center', paddingVertical: 14, alignItems: 'center' },
});
