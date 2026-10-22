import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { recordShare } from '../../../lib/cinemaSocial';
import { SaveFollow } from '../../../components/cinema/SaveFollow';
import { VotePolls } from '../../../components/cinema/VotePolls';
import { useAuth } from '../../../auth/AuthProvider';
import { blockMember, blocksErrorKey } from '../../../lib/cinemaBlocks';
import { plural, t } from '../../../lib/i18n';
import { formatDuration, parseTitleDetail, posterUrl, type TitleDetail } from '../../../lib/cinema';
import { categoryKey, fetchEntitlement, firstEpisode, firstWatchable, lockMessageKey, titleShareUrl, type LockReason } from '../../../lib/cinemaBrowse';
import { parseEpisodeLocks } from '../../../lib/cinemaSeries';
import { colors, fonts } from '../../../theme';

export default function CinemaTitlePage() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { api } = useAuth();
    const router = useRouter();
    const [detail, setDetail] = useState<TitleDetail | null>(null);
    const [detailLocks, setDetailLocks] = useState<ReadonlyMap<string, LockReason | null>>(new Map());
    const [episodeLocks, setEpisodeLocks] = useState<ReadonlyMap<string, LockReason | null>>(new Map());
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let live = true;
        api.request<unknown>(`/api/v1/cinema/titles/${encodeURIComponent(id)}`)
            .then((body) => {
                const parsed = parseTitleDetail(body);
                if (!live) return;
                if (parsed) { setDetailLocks(parseEpisodeLocks(body)); setDetail(parsed); }
                else setFailed(true);
            })
            .catch(() => live && setFailed(true));
        return () => { live = false; };
    }, [api, id]);

    // Detail's free access is unmetered. Check only free candidates, serially:
    // entitlement shares the account's read quota with Play and other requests.
    // Keep completed screen state across unchanged focus cycles; playback invalidates it.
    const checked = useRef<{ api: typeof api; detail: TitleDetail; detailLocks: typeof detailLocks } | null>(null);
    const entitlementQueue = useRef(Promise.resolve());
    const [lock, setLock] = useState<LockReason | 'checking' | null>(null);
    const [entOpen, setEntOpen] = useState(false);
    useFocusEffect(useCallback(() => {
        if (!detail || detail.title.contentType !== 'SERIES') return;
        if (checked.current?.api === api && checked.current.detail === detail && checked.current.detailLocks === detailLocks) return;
        let live = true;
        setEpisodeLocks(new Map());
        setLock(detail.episodes.length ? 'checking' : null);
        // A rapid blur/refocus must not overlap the still-pending request from the old batch.
        const run = entitlementQueue.current.then(async () => {
            const locks = new Map(detailLocks);
            const freeEpisodes = detail.episodes.filter(e => detailLocks.get(e.id) === null)
                .sort((a, b) => a.season - b.season || a.position - b.position);
            for (const episode of freeEpisodes) {
                if (!live) return;
                const entitlement = await fetchEntitlement(api, episode.id);
                if (!live) return;
                locks.set(episode.id, entitlement.kind === 'locked' ? entitlement.reason : null);
            }
            if (!live) return;
            checked.current = { api, detail, detailLocks };
            setEpisodeLocks(locks);
            const eligible = detail.episodes.filter(e => locks.get(e.id) === null);
            const first = firstEpisode(detail.episodes);
            setLock(eligible.length ? null : first ? locks.get(first.id) ?? 'locked' : null);
        });
        entitlementQueue.current = run;
        return () => { live = false; };
    }, [api, detail, detailLocks]));

    useEffect(() => {
        // Preserve the existing film/short eligibility and Play behavior.
        if (!detail || detail.title.contentType === 'SERIES') return;
        if (detail.watchable) { setLock(null); return; }
        let live = true;
        setLock('checking');
        fetchEntitlement(api, detail.title.id).then(e => {
            if (!live) return;
            if (e.kind === 'open') { setEntOpen(true); setLock(null); } else setLock(e.reason);
        });
        return () => { live = false; };
    }, [api, detail]);
    const episodes = detail?.episodes.map(e => ({ ...e, watchable: episodeLocks.has(e.id) && episodeLocks.get(e.id) === null })) ?? [];

    const share = () => {
        const url = titleShareUrl(id);
        if (!url || !detail) return;
        // Only a completed share counts toward the audience; dismissing the sheet records nothing.
        void Share.share({ message: `${detail.title.title}\n${url}`, url })
            .then((r) => { if (r.action === Share.sharedAction) void recordShare(api, id, Crypto.randomUUID()); })
            .catch(() => undefined);
    };
    const watch = (contentId: string, title: string, series?: string) => {
        if (series) checked.current = null;
        router.push({ pathname: '/cinema/watch/[id]', params: { id: contentId, title, ...(series ? { series } : {}) } });
    };
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
            {title.categories.length ? <Text style={styles.muted}>{title.categories.map((c) => t(categoryKey(c))).join(' · ')}</Text> : null}
            {title.contentType === 'SERIES' ? <Text style={styles.muted}>{plural('cinemaBrowse.episodes', title.episodeCount || detail.episodes.length)}</Text> : null}
            {title.synopsis ? <Text style={styles.body}>{title.synopsis}</Text> : null}
            {title.contentType === 'SERIES' && firstWatchable(episodes) ? (
                <Pressable accessibilityRole="button" style={styles.play} onPress={() => { const e = firstWatchable(episodes); if (e) watch(e.id, e.title, title.id); }}>
                    <Text style={styles.playText}>{t('cinemaBrowse.watch')}</Text>
                </Pressable>
            ) : null}
            {lock === 'checking' ? <ActivityIndicator color={colors.accent} /> : lock ? (
                <View style={styles.locked} accessibilityRole="alert">
                    <Text style={styles.lockedTitle}>{t('cinemaBrowse.lock.title')}</Text>
                    <Text style={styles.body}>{t(lockMessageKey(lock))}</Text>
                </View>
            ) : null}
            {title.contentType !== 'SERIES' ? (
                detail.watchable || entOpen ? (
                    <Pressable accessibilityRole="button" style={styles.play} onPress={() => watch(title.id, title.title)}>
                        <Text style={styles.playText}>Play</Text>
                    </Pressable>
                ) : lock ? null : (
                    <Text style={styles.muted}>This title is not available to watch in the app yet.</Text>
                )
            ) : (
                episodes.map((e) => (
                    <Pressable
                        key={e.id}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !e.watchable }}
                        disabled={!e.watchable}
                        style={[styles.row, !e.watchable && styles.rowOff]}
                        onPress={() => watch(e.id, e.title, title.id)}
                    >
                        <Text style={styles.rowTitle} numberOfLines={1}>S{e.season} E{e.position} · {e.title}</Text>
                        <Text style={styles.muted}>{e.watchable ? formatDuration(e.durationSeconds) : t(episodeLocks.get(e.id) === 'free_ceiling' ? 'cinemaSeries.state.free_ceiling' : (episodeLocks.get(e.id) ?? detailLocks.get(e.id)) === 'paid' ? 'cinemaSeries.state.paid' : 'cinemaSeries.state.locked')}</Text>
                    </Pressable>
                ))
            )}
            <SaveFollow contentId={title.id} />
            <VotePolls contentId={title.id} />
            <Pressable accessibilityRole="button" style={styles.report} onPress={share}>
                <Text style={styles.muted}>{t('cinemaBrowse.share')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.report} onPress={() => router.push({ pathname: '/cinema/comments', params: { id: title.id } })}>
                <Text style={styles.muted}>{t('comments.title')}</Text>
            </Pressable>
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
    title: { color: colors.text, fontFamily: fonts.display, fontSize: 24 },
    body: { color: colors.body, fontSize: 16 },
    muted: { color: colors.muted },
    play: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    playText: { color: colors.accentInk, fontSize: 16, fontWeight: '700' },
    row: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 2 },
    rowOff: { opacity: 0.5 },
    locked: { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 12, padding: 14, gap: 6 },
    lockedTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
    rowTitle: { color: colors.text, fontSize: 16 },
    report: { minHeight: 44, justifyContent: 'center', paddingVertical: 14, alignItems: 'center' },
});
