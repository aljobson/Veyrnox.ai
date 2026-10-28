import { copyText } from '../../../../lib/clipboard';
import { t } from '../../../../lib/i18n';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../../../../lib/a11y';
import { SHOT_LANES, handoffFor, latestPrompt, shotRow, type Film } from '../../../../lib/filmStudio';
import { loadActiveStudio } from '../../../../lib/filmCloud';
import { getCacheUser, subscribeCacheUser } from '../../../../lib/appCache';
import { fetchCatalogCached, type CatalogModel } from '../../../../lib/media';
import { colors } from '../../../../theme';

// One shot of an imported studio: its card, assets, prompt and attempts, and a way to take a current prompt to Create.
// The price is shown before anything is opened. Nothing is charged here: Create asks again and charges only on its own
// Generate button.
export default function FilmShot() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const [film, setFilm] = useState<Film | null | undefined>(undefined);
    const [catalog, setCatalog] = useState<CatalogModel[] | null>(null);

    const generation = useRef(0);

    useEffect(() => {
        let live = true;
        const reload = () => {
            const token = ++generation.current;
            const owner = getCacheUser();
            setFilm(undefined);
            loadActiveStudio().then(
                s => { if (live && token === generation.current && owner === getCacheUser()) setFilm(s?.film ?? null); },
                () => { if (live && token === generation.current) setFilm(null); },
            );
        };
        const unsubscribe = subscribeCacheUser(reload);
        reload();
        fetchCatalogCached((models) => live && setCatalog(models)).catch(() => live && setCatalog([]));
        return () => {
            live = false;
            ++generation.current;
            unsubscribe();
        };
    }, []);

    if (film === undefined) return <ActivityIndicator color={colors.accent} style={styles.center} />;
    const shot = film?.shots.find((s) => s.id === id);
    if (!film || !shot) {
        return (
            <View style={styles.screen}>
                <Stack.Screen options={{ title: t('film.shot') }} />
                <Text style={styles.muted}>{t('film.thatshotisnotinthestudio')}</Text>
            </View>
        );
    }

    const row = shotRow(film, shot);
    const prompt = latestPrompt(film, shot.id);
    const attempts = film.attempts.filter((a) => a.shot === shot.id);
    const offer = catalog ? handoffFor(film, shot, catalog) : null;
    const session = generation.current;
    const owner = getCacheUser();
    // A queued press from the previous render must not use a revoked film.
    const current = () => session === generation.current && owner === getCacheUser();

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: shot.id }} />
            <Text style={styles.title} accessibilityRole="header">{shot.id}</Text>
            <Text style={styles.status}>{row.label}</Text>

            <Text style={styles.heading} accessibilityRole="header">{t('film.assets')}</Text>
            {row.assets.length === 0 ? <Text style={styles.muted}>{t('film.noassetsnamed')}</Text> : null}
            {row.assets.map((a) => (
                <Text key={a.key} style={a.locked ? styles.good : styles.muted}>
                    {a.key} · {a.locked ? t('film.locked') : t('film.draft')}
                </Text>
            ))}

            <Text style={styles.heading} accessibilityRole="header">{t('film.makethisshot')}</Text>
            {!prompt ? <Text style={styles.muted}>{t('film.nopromptyet')}</Text> : null}
            {!offer ? <ActivityIndicator color={colors.accent} /> : null}
            {offer && offer.ok ? (
                <>
                    <Text style={styles.money}>{t('film.creditsseconds', { value1: offer.credits, value2: offer.model.name, value3: offer.seconds })}</Text>
                    <Text style={styles.muted}>{t('film.thisopensCreatewiththepromptfilled')}</Text>
                    <Pressable accessibilityRole="button" style={styles.primary} onPress={() => { if (current()) router.push({ pathname: '/create/[modelId]', params: { modelId: offer.model.id, prompt: offer.prompt, duration: String(offer.seconds), aspect: offer.aspect } }); }}>
                        <Text style={styles.primaryText}>{t('film.openinCreate')}</Text>
                    </Pressable>
                </>
            ) : offer ? (
                <Text style={styles.muted}>{offer.reason}</Text>
            ) : null}
            {prompt ? <Pressable accessibilityRole="button" style={[styles.secondary, touchTarget]} onPress={async () => {
                if (!current()) return;
                const ok = await copyText(prompt.content);
                if (current()) AccessibilityInfo.announceForAccessibility(t(ok ? 'filmOutput.copied' : 'filmOutput.copyFailed'));
            }}><Text style={styles.secondaryText}>{t('filmOutput.copy')}</Text></Pressable> : null}
            {prompt ? (
                <Pressable accessibilityRole="button" style={[styles.secondary, touchTarget]} onPress={() => { if (current()) void Share.share({ message: prompt.content }); }}>
                    <Text style={styles.secondaryText}>{t('film.sharethefullprompt')}</Text>
                </Pressable>
            ) : null}

            {attempts.length ? <Text style={styles.heading} accessibilityRole="header">{t('film.attempts')}</Text> : null}
            {attempts.map((a) => (
                <View key={a.version} style={styles.attempt}>
                    <Text style={styles.name}>{t('film.version', { value1: a.version, value2: a.verdict })}</Text>
                    <Text style={styles.muted}>{a.changed}</Text>
                </View>
            ))}

            <Text style={styles.heading} accessibilityRole="header">{t('film.shotcard')}</Text>
            {SHOT_LANES.map(([lane, fields]) => (
                <View key={lane} style={styles.lane}>
                    <Text style={styles.laneName}>{lane}</Text>
                    {fields.map(([key, label]) => (
                        <View key={key} style={styles.field}>
                            <Text style={styles.label}>{label}</Text>
                            <Text style={styles.value}>{String(shot[key] ?? '') || '—'}</Text>
                        </View>
                    ))}
                </View>
            ))}


        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 16 },
    content: { gap: 8, paddingBottom: 48 },
    center: { flex: 1 },
    title: { color: colors.text, fontSize: 22, fontWeight: '700' },
    status: { color: colors.body, fontSize: 14 },
    heading: { color: colors.text, fontSize: 17, fontWeight: '600', marginTop: 16 },
    muted: { color: colors.muted, fontSize: 13 },
    good: { color: colors.accent, fontSize: 14 },
    money: { color: colors.money, fontSize: 16, fontWeight: '600' },
    name: { color: colors.text, fontSize: 15 },
    attempt: { paddingVertical: 8, gap: 2 },
    lane: { gap: 6, marginTop: 8 },
    laneName: { color: colors.accent, fontWeight: '600' },
    field: { gap: 1 },
    label: { color: colors.muted, fontSize: 12 },
    value: { color: colors.body, fontSize: 14 },
    primary: { minHeight: 48, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
    primaryText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    secondary: { minHeight: 44, borderRadius: 10, borderColor: colors.border, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
    secondaryText: { color: colors.accent, fontWeight: '600' },
});
