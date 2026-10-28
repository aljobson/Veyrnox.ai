import { Stack, useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { HeaderAction } from '../../../../components/HeaderAction';
import { useAuth } from '../../../../auth/AuthProvider';
import { Button, Text } from '../../../../components/ui';
import { VotePolls } from '../../../../components/cinema/VotePolls';
import { CommentsPreview } from '../../../../components/cinema/CommentsPreview';
import { nextCandidate } from '../../../../lib/cinemaViewer';
import { parseTitleDetail, type Episode, type TitleDetail } from '../../../../lib/cinema';
import { parseEpisodeLocks } from '../../../../lib/cinemaSeries';
import { type BlockReason } from '../../../../lib/cinemaPlayback';
import { colors } from '../../../../theme';
import { fetchEntitlement, isTitleId } from '../../../../lib/cinemaBrowse';
import { t } from '../../../../lib/i18n';
import { CinemaPlayer } from '../../../../components/cinema/CinemaPlayer';

// Full-screen player for one film, short or episode. The token is minted when this screen opens.
export default function Watch() {
    const { id, title, position, series } = useLocalSearchParams<{ id: string; title?: string; position?: string; series?: string }>();
    const router = useRouter();
    const navigation = useNavigation();
    const { api } = useAuth();
    const { height } = useWindowDimensions();
    const [data, setData] = useState<{ detail: TitleDetail; candidate: Episode | null } | null>(null);
    const [confirmed, setConfirmed] = useState<Episode | null>(null);
    const [checking, setChecking] = useState(false);
    const generation = useRef(0);
    const suspended = useRef(false);
    const pressing = useRef(false);
    useEffect(() => {
        let live = true;
        setData(null);
        if (series && isTitleId(series)) void api.request(`/api/v1/cinema/titles/${encodeURIComponent(series)}`).then(body => {
            const detail = parseTitleDetail(body);
            if (live && detail?.episodes.some(e => e.id === id)) setData({ detail, candidate: nextCandidate(detail, id, parseEpisodeLocks(body)) });
        }).catch(() => undefined);
        return () => { live = false; };
    }, [api, series, id]);
    useFocusEffect(useCallback(() => {
        suspended.current = false;
        return () => { ++generation.current; };
    }, [api, id]));
    // The detail lock is unmetered. Confirm only the immediate candidate on each focus.
    useFocusEffect(useCallback(() => {
        const version = ++generation.current;
        pressing.current = false;
        setConfirmed(null);
        setChecking(false);
        const candidate = data?.candidate;
        if (candidate && !suspended.current) void fetchEntitlement(api, candidate.id).then(answer => {
            if (version === generation.current && !suspended.current && answer.kind === 'open') setConfirmed(candidate);
        });
        return () => { ++generation.current; };
    }, [api, data]));
    const onBlocked = useCallback((reason: BlockReason) => {
        if (reason === 'free_ceiling' || reason === 'pass_ceiling' || reason === 'locked') {
            suspended.current = true;
            ++generation.current;
            setConfirmed(null);
        }
    }, []);
    const next = async () => {
        if (!confirmed || pressing.current || suspended.current) return;
        pressing.current = true;
        setChecking(true);
        const version = generation.current;
        const candidate = confirmed;
        const answer = await fetchEntitlement(api, candidate.id);
        if (version !== generation.current || suspended.current) return;
        pressing.current = false;
        setChecking(false);
        if (answer.kind !== 'open') { setConfirmed(null); return; }
        router.replace({ pathname: '/cinema/watch/[id]', params: { id: candidate.id, title: candidate.title, series: series! } });
    };
    const episode = data?.detail.episodes.find(e => e.id === id);
    // Remove the player, returning to the existing parent or replacing a direct watch link.
    const allEpisodes = typeof series === 'string' && isTitleId(series)
        ? () => {
            const href = `/cinema/${series.toLowerCase()}` as const;
            const hasParent = navigation.getState()?.routes.some(route =>
                route.name === 'cinema/[id]' && route.params && 'id' in route.params && typeof route.params.id === 'string' && route.params.id.toLowerCase() === series.toLowerCase());
            if (hasParent) router.dismissTo(href);
            else router.replace(href);
        } : null;
    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: title ?? t('cinema.nowplaying'), ...(allEpisodes ? { headerRight: () => <HeaderAction label={t('cinemaSeries.allEpisodes')} onPress={allEpisodes} /> } : {}) }} />
            <CinemaPlayer contentId={id} resumePosition={Number(position ?? 0)} onBlocked={onBlocked} />
            <ScrollView style={{ flexGrow: 0, maxHeight: height * 0.45, backgroundColor: colors.background }}>
                {data && episode ? <View style={{ padding: 16, gap: 8 }}>
                    <Text>{data.detail.title.title}</Text>
                    <Text tone="secondary">{t('cinema.title.position', { season: episode.season, episode: episode.position })}</Text>
                    <Text variant="title3" accessibilityRole="header">{episode.title}</Text>
                </View> : null}
                {confirmed ? <Button label={t('cinema.player.next')} disabled={checking} loading={checking} onPress={next} /> : null}
                <VotePolls key={id} contentId={id} />
                <CommentsPreview key={`comments-${id}`} contentId={id} />
                {allEpisodes ? <Button variant="tertiary" label={t('cinema.player.backToTheTitle')} onPress={allEpisodes} /> : null}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#000' } });
