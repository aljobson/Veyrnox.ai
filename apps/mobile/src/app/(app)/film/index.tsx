import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../../../lib/a11y';
import { shotRows, stageStatuses, summarize, type Film } from '../../../lib/filmStudio';
import { clearStudio } from '../../../lib/filmStudioStore';
import { useAuth } from '../../../auth/AuthProvider';
import { getCacheUser, subscribeCacheUser } from '../../../lib/appCache';
import { clearOpenedFilm, fetchCloudFilms, loadActiveStudio } from '../../../lib/filmCloud';
import { formatLocale, plural, t } from '../../../lib/i18n';
import { colors } from '../../../theme';

// ADR-0210 and ADR-0252: open and edit a native film or a film saved to the account.
export default function FilmStudio() {
    const router = useRouter();
    const { api } = useAuth();
    const [cloudCount, setCloudCount] = useState<number | null>(null);
    const generation = useRef(0);
    const loadToken = useRef(0);
    const [film, setFilm] = useState<Film | null>(null);
    const [loading, setLoading] = useState(true);
    const [savedAt, setSavedAt] = useState<number | null>(null);

    const reload = useCallback(() => {
        const token = ++loadToken.current;
        const session = generation.current;
        const owner = getCacheUser();
        loadActiveStudio().then(
            (s) => {
                if (token !== loadToken.current || session !== generation.current || owner !== getCacheUser()) return;
                setFilm(s?.film ?? null);
                setSavedAt(s?.savedAt ?? null);
                setLoading(false);
            },
            () => { if (token === loadToken.current && session === generation.current) setLoading(false); },
        );
    }, []);

    useFocusEffect(useCallback(() => {
        reload();
        return () => { ++loadToken.current; };
    }, [reload]));

    useEffect(() => {
        const fetchCount = async () => {
            const session = generation.current;
            const owner = getCacheUser();
            if (!owner) return;
            try {
                const rows = await fetchCloudFilms(api);
                if (session === generation.current && owner === getCacheUser()) setCloudCount(rows.length);
            } catch { /* The optional row stays absent on every failure. */ }
        };
        const unsubscribe = subscribeCacheUser(() => {
            ++generation.current;
            setFilm(null);
            setSavedAt(null);
            setCloudCount(null);
            setLoading(true);
            reload();
            void fetchCount();
        });
        void fetchCount();
        return () => { unsubscribe(); ++generation.current; ++loadToken.current; };
    }, [api, reload]);

    const remove = useCallback(async () => {
        const session = generation.current;
        await clearStudio();
        if (session !== generation.current) return;
        clearOpenedFilm();
        setFilm(null);
        setSavedAt(null);
    }, []);

    if (loading) return <ActivityIndicator color={colors.accent} style={styles.center} />;

    if (!film) {
        return (
            <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
                <Stack.Screen options={{ title: t('film.filmStudio') }} />
                <Text style={styles.title} accessibilityRole="header">{t('film.startoropenafilm')}</Text>
                <Text style={styles.body}>{t('filmCloud.intro')}</Text>
                <Pressable accessibilityRole="button" style={styles.primary} onPress={() => router.push('/film/workspace')}>
                    <Text style={styles.primaryText}>{t('film.startanewfilm')}</Text>
                </Pressable>
                <Links router={router} cloudCount={cloudCount} />
            </ScrollView>
        );
    }

    const sum = summarize(film);
    const stages = stageStatuses(film);
    const rows = shotRows(film);
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('film.filmStudio') }} />
            <Text style={styles.title} accessibilityRole="header">{sum.name}</Text>
            <Text style={styles.muted}>{t('film.ofassetslockedtakesaccepted', { value1: sum.aspect, value2: plural('film.shotCount', sum.shots), value3: '', value4: sum.lockedAssets, value5: sum.assets, value6: sum.acceptedShots })}</Text>
            <Text style={styles.body}>{t('filmCloud.intro')}</Text>
            <Text style={styles.muted}>{t('film.openedYoucanediteverystageon', { value1: savedAt ? new Date(savedAt).toLocaleDateString(formatLocale()) : t('film.fromAccount') })}</Text>

            <Pressable accessibilityRole="button" style={styles.primary} onPress={() => router.push('/film/workspace')}>
                <Text style={styles.primaryText}>{t('film.editinFilmStudio')}</Text>
            </Pressable>

            <Text style={styles.heading} accessibilityRole="header">{t('film.stages')}</Text>
            {stages.map((s, i) => (
                <View key={s.id} style={styles.row} accessible accessibilityLabel={t('film.stage', { value1: i + 1, value2: s.title, value3: s.done ? t('film.done') : t('film.remaining', { count: s.open }) })}>
                    <Text style={styles.name}>
                        {s.done ? '✓' : '•'} {i + 1}. {s.title}
                    </Text>
                    {s.done ? null : (
                        <>
                            <Text style={styles.muted}>{t('film.tofix', { value1: s.open, value2: s.first ?? '' })}</Text>
                            <Text style={styles.web}>{t('film.openthenativeworkspace')}</Text>
                        </>
                    )}
                </View>
            ))}

            <Text style={styles.heading} accessibilityRole="header">{t('film.shots')}</Text>
            {rows.length === 0 ? <Text style={styles.muted}>{t('film.noshotsyetAddtheminthe')}</Text> : null}
            {rows.map((r) => (
                <Pressable key={r.shot.id} accessibilityRole="button" accessibilityLabel={`${r.shot.id}, ${r.label}`} style={[styles.row, touchTarget]} onPress={() => router.push({ pathname: '/film/shot/[id]', params: { id: r.shot.id } })}>
                    <Text style={styles.name}>{r.shot.id}</Text>
                    <Text style={styles.muted}>{String(r.shot.description).slice(0, 110)}</Text>
                    <Text style={r.state === 'accepted' ? styles.good : r.state === 'prompt-ready' ? styles.ready : styles.muted}>{r.label}</Text>
                </Pressable>
            ))}

            <Pressable accessibilityRole="button" style={[styles.secondary, touchTarget]} onPress={remove}>
                <Text style={styles.secondaryText}>{t('film.removefromthisphone')}</Text>
            </Pressable>
            <Links router={router} cloudCount={cloudCount} />
        </ScrollView>
    );
}

function Links({ router, cloudCount }: { router: ReturnType<typeof useRouter>; cloudCount: number | null }) {
    return (
        <View style={styles.links}>
            {cloudCount !== null && cloudCount >= 1 ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`${t('filmCloud.linkTitle')}, ${plural('filmCloud.linkCount', cloudCount)}`} style={[styles.row, touchTarget]} onPress={() => router.push('/film/cloud')}>
                    <Text style={styles.name}>{t('filmCloud.linkTitle')}</Text>
                    <Text style={styles.muted}>{plural('filmCloud.linkCount', cloudCount)}</Text>
                </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" style={[styles.row, touchTarget]} onPress={() => router.push('/chat/new')}>
                <Text style={styles.name}>{t('film.filmchats')}</Text>
                <Text style={styles.muted}>{t('film.sevenhelpersforsetupbreakdownreferencespassports')}</Text>
            </Pressable>

        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 8, paddingBottom: 48 },
    center: { flex: 1 },
    title: { color: colors.text, fontSize: 22, fontWeight: '700' },
    heading: { color: colors.text, fontSize: 17, fontWeight: '600', marginTop: 16 },
    body: { color: colors.body, fontSize: 15 },
    muted: { color: colors.muted, fontSize: 13 },
    row: { paddingVertical: 12, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, gap: 3 },
    name: { color: colors.text, fontSize: 16 },
    web: { color: colors.accent, fontSize: 13, fontWeight: '600' },
    good: { color: colors.accent, fontSize: 13, fontWeight: '600' },
    ready: { color: colors.money, fontSize: 13, fontWeight: '600' },
    links: { marginTop: 16 },
    primary: { minHeight: 48, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
    primaryText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    secondary: { minHeight: 44, borderRadius: 10, borderColor: colors.border, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
    secondaryText: { color: colors.accent, fontWeight: '600' },
});
