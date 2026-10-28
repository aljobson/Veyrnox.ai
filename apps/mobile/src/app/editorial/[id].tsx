import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthProvider';
import { YouTubeEmbed, type YouTubeEmbedHandle } from '../../components/cinema/YouTubeEmbed';
import { Button, Icon, Text } from '../../components/ui';
import { touchTarget } from '../../lib/a11y';
import { editorialEpisodeContext } from '../../lib/cinemaSeries';
import { t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { embedErrorKey, type EmbedErrorCause } from '../../lib/youtubeEmbed';
import { colors } from '../../theme';

type Status = null | { kind: 'blocked' } | { kind: 'error'; key: string; cause: EmbedErrorCause; attempt: number };
export default function EditorialPlayer() {
    const { id, series: slug } = useLocalSearchParams<{ id: string; series: string }>();
    // Replacing an episode also resets its attempt, callbacks and native player.
    return <EpisodePlayer key={`${slug}/${id}`} slug={slug} id={id} />;
}
function EpisodePlayer({ slug, id }: { slug: string; id: string }) {
    const context = editorialEpisodeContext(slug, id);
    const { status: authStatus } = useAuth();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const player = useRef<YouTubeEmbedHandle>(null);
    const currentAttempt = useRef(0);
    const [attempt, setAttempt] = useState(0);
    const [status, setStatus] = useState<Status>(null);
    const statusText = status ? t(status.kind === 'blocked' ? 'cinemaEmbed.linkBlocked' : status.key) : null;
    useAnnouncement(statusText);
    useFocusEffect(useCallback(() => () => player.current?.pause(), []));
    useEffect(() => {
        const subscription = AppState.addEventListener('change', state => { if (state !== 'active') player.current?.pause(); });
        return () => subscription.remove();
    }, []);
    const allEpisodes = () => router.replace({ pathname: '/cinema/series/[slug]', params: { slug } });
    const close = () => {
        if (router.canGoBack()) router.back();
        else if (authStatus === 'signedIn') allEpisodes();
        else router.replace('/preview');
    };
    const handleReady = (sourceAttempt: number) => {
        if (sourceAttempt !== currentAttempt.current) return;
        setStatus(previous => previous?.kind === 'error' && previous.cause === 'timeout' && previous.attempt === sourceAttempt ? null : previous);
    };
    const handleError = (sourceAttempt: number, cause: EmbedErrorCause) => {
        if (sourceAttempt === currentAttempt.current) setStatus({ kind: 'error', key: embedErrorKey(cause), cause, attempt: sourceAttempt });
    };
    const handleBlocked = (sourceAttempt: number) => {
        if (sourceAttempt === currentAttempt.current) setStatus(previous => previous?.kind === 'error' ? previous : { kind: 'blocked' });
    };
    const retry = () => { currentAttempt.current += 1; setStatus(null); setAttempt(currentAttempt.current); };
    return (
        <View style={[styles.screen, { paddingTop: insets.top }]}>
            <View style={styles.bar}>
                <Pressable accessibilityRole="button" accessibilityLabel={t('cinemaEmbed.close')} style={[touchTarget, styles.close]} onPress={close}>
                    <Icon name="arrowLeft" size={24} tint={colors.text} />
                </Pressable>
                <Text accessibilityRole="header" style={styles.barTitle}>{context?.episode.title ?? t('cinemaSeries.unavailable')}</Text>
            </View>
            {context ? <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
                <YouTubeEmbed key={attempt} ref={player} videoId={context.episode.videoId} durationSeconds={context.episode.durationSeconds}
                    title={context.episode.title} onReady={() => handleReady(attempt)} onError={cause => handleError(attempt, cause)} onBlocked={() => handleBlocked(attempt)} />
                <View style={styles.content}>
                    {statusText ? <Text accessibilityLiveRegion={Platform.OS === 'android' ? 'polite' : undefined}>{statusText}</Text> : null}
                    {status?.kind === 'error' ? <Button label={t('cinemaEmbed.retry')} onPress={retry} /> : null}
                    <Text accessibilityRole="header">{context.series.title} · {t('cinema.title.position', { season: context.series.season, episode: context.episode.position })}</Text>
                    <Text accessibilityRole="header" variant="title2">{context.episode.title}</Text>
                    <Text>{t('cinemaEmbed.rights', { creator: context.series.creatorName })}</Text>
                    {context.next ? <Button label={t('cinema.player.next', { title: context.next.title })}
                        onPress={() => router.replace({ pathname: '/editorial/[id]', params: { id: context.next!.id, series: slug } })} /> : null}
                    {authStatus === 'signedIn' ? <Button label={t('cinemaSeries.allEpisodes')} variant="secondary" onPress={allEpisodes} /> : null}
                </View>
            </ScrollView> : <Text style={styles.content}>{t('cinemaSeries.unavailable')}</Text>}
        </View>
    );
}
const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
    close: { width: 44, alignItems: 'center', justifyContent: 'center' },
    barTitle: { flex: 1, fontSize: 18, fontWeight: '700' },
    content: { padding: 16, gap: 12 },
});
