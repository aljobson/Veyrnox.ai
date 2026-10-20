import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { MIN_TARGET } from '../../lib/a11y';
import { posterUrl } from '../../lib/cinema';
import { createProgressList, emptyProgressView, getCinemaProgress, type ProgressItem } from '../../lib/cinemaProgress';
import { socialErrorKey } from '../../lib/cinemaSocial';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

export function ContinueWatching() {
    const { api, status, getAccessToken } = useAuth();
    const router = useRouter();
    const client = getCinemaProgress(api, getAccessToken);
    const [view, setView] = useState(emptyProgressView);
    const [removing, setRemoving] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const list = useRef<ReturnType<typeof createProgressList> | null>(null);
    const writing = useRef(false);

    useFocusEffect(useCallback(() => {
        setNote(null); setRemoving(null); writing.current = false;
        if (status !== 'signedIn') { setView(emptyProgressView); return; }
        const current = createProgressList(client, setView);
        list.current = current;
        void current.reload();
        return () => { current.dispose(); list.current = null; setView(emptyProgressView); };
    }, [client, status]));

    async function dismiss(item: ProgressItem) {
        const current = list.current;
        if (!current || writing.current) return;
        writing.current = true;
        setRemoving(item.contentId); setNote(null);
        try { await client.dismiss(item.contentId); }
        catch (error) { if (list.current === current) setNote(socialErrorKey(error)); }
        finally {
            if (list.current === current) { writing.current = false; setRemoving(null); }
        }
    }

    if (status !== 'signedIn' || view.status === 'closed' || client.isClosed() || client.isNotEligible()) return null;
    if (!view.items.length && view.status !== 'error') return null;
    const error = note ?? view.error;
    return (
        <View style={styles.section}>
            <Text style={styles.heading} accessibilityRole="header">{t('cinema.progress.heading')}</Text>
            {error ? (
                <Pressable accessibilityRole="button" style={styles.retry} onPress={() => { setNote(null); void list.current?.reload(); }}>
                    <Text style={styles.error}>{t(error)} {t('cinema.progress.retry')}</Text>
                </Pressable>
            ) : null}
            <FlatList
                horizontal
                data={view.items}
                keyExtractor={(item) => item.contentId}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.row}
                onEndReached={() => { void list.current?.loadMore(); }}
                onEndReachedThreshold={0.5}
                renderItem={({ item }) => (
                    <View style={styles.card}>
                        <Pressable accessibilityRole="button" accessibilityLabel={t('cinema.progress.resume', { title: item.title })}
                            onPress={() => router.push({ pathname: '/cinema/watch/[id]', params: { id: item.contentId, title: item.title, position: String(item.position) } })}>
                            <Image source={{ uri: posterUrl(item.contentId) }} style={styles.poster} contentFit="cover" accessible={false} accessibilityIgnoresInvertColors />
                            <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                            <Text style={styles.creator} numberOfLines={1}>{item.creator}</Text>
                            <View style={styles.track} accessibilityRole="progressbar" accessibilityLabel={t('cinema.progress.watched')}
                                accessibilityValue={{ min: 0, max: item.duration, now: item.position }}>
                                <View style={[styles.progress, { width: `${100 * item.position / item.duration}%` }]} />
                            </View>
                        </Pressable>
                        <Pressable accessibilityRole="button" style={styles.dismiss} disabled={removing !== null}
                            accessibilityState={{ disabled: removing !== null }} accessibilityLabel={t('cinema.progress.dismissTitle', { title: item.title })}
                            onPress={() => { void dismiss(item); }}>
                            <Text style={styles.creator}>{t('cinema.progress.dismiss')}</Text>
                        </Pressable>
                    </View>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    section: { paddingTop: 8, paddingBottom: 4 },
    heading: { color: colors.text, fontSize: 18, fontWeight: '600', paddingHorizontal: 16, marginBottom: 8 },
    row: { paddingHorizontal: 16, gap: 12 },
    card: { width: 156, backgroundColor: colors.surface, borderRadius: 8, overflow: 'hidden' },
    poster: { width: 156, height: 80 },
    cardTitle: { color: colors.text, fontWeight: '600', paddingHorizontal: 8, paddingTop: 6 },
    creator: { color: colors.muted, paddingHorizontal: 8 },
    track: { height: 4, margin: 8, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' },
    progress: { height: 4, backgroundColor: colors.accent },
    dismiss: { minHeight: MIN_TARGET, justifyContent: 'center' },
    retry: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 16 },
    error: { color: colors.danger },
});
