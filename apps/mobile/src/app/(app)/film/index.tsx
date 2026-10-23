import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { API_BASE } from '../../../lib/api';
import { touchTarget } from '../../../lib/a11y';
import { FILM_STUDIO_WEB_PATH, MAX_FILM_BYTES, shotRows, stageStatuses, summarize, type Film } from '../../../lib/filmStudio';
import { clearStudio, saveStudio } from '../../../lib/filmStudioStore';
import { useAuth } from '../../../auth/AuthProvider';
import { getCacheUser, subscribeCacheUser } from '../../../lib/appCache';
import { clearOpenedFilm, fetchCloudFilms, loadActiveStudio } from '../../../lib/filmCloud';
import { plural, t } from '../../../lib/i18n';
import { colors } from '../../../theme';

// ADR-0210 and ADR-0252: read a file import or a film opened from the account.
export default function FilmStudio() {
    const router = useRouter();
    const { api } = useAuth();
    const [cloudCount, setCloudCount] = useState<number | null>(null);
    const generation = useRef(0);
    const loadToken = useRef(0);
    const [film, setFilm] = useState<Film | null>(null);
    const [loading, setLoading] = useState(true);
    const [savedAt, setSavedAt] = useState<number | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

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
            setProblem(null);
            setBusy(false);
            setCloudCount(null);
            setLoading(true);
            reload();
            void fetchCount();
        });
        void fetchCount();
        return () => { unsubscribe(); ++generation.current; ++loadToken.current; };
    }, [api, reload]);

    const pick = useCallback(async () => {
        if (busy) return;
        const session = generation.current;
        setBusy(true);
        setProblem(null);
        try {
            const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true, multiple: false });
            if (session !== generation.current) return;
            if (res.canceled || !res.assets[0]) return;
            const asset = res.assets[0];
            if (typeof asset.size === 'number' && asset.size > MAX_FILM_BYTES) return setProblem('The studio file must be smaller than 1 MB.');
            const raw = await new File(asset.uri).text();
            if (session !== generation.current) return;
            const saved = await saveStudio(raw);
            if (session !== generation.current) return;
            if (!saved.ok) return setProblem(saved.error);
            clearOpenedFilm();
            setFilm(saved.film);
            setSavedAt(Date.now());
        } catch {
            if (session !== generation.current) return;
            setProblem('That file could not be read. Try exporting it again from the web.');
        } finally {
            if (session === generation.current) setBusy(false);
        }
    }, [busy]);

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
                <Stack.Screen options={{ title: 'Film Studio' }} />
                <Text style={styles.title} accessibilityRole="header">Start or open a film</Text>
                <Text style={styles.body}>{t('filmCloud.intro')}</Text>
                <Pressable accessibilityRole="button" style={styles.primary} onPress={() => router.push('/film/workspace')}>
                    <Text style={styles.primaryText}>Start a new film</Text>
                </Pressable>
                <Text style={styles.heading} accessibilityRole="header">Open an export</Text>
                <Text style={styles.step}>1. On veyrnox.ai open Film Studio and export your studio as JSON.</Text>
                <Text style={styles.step}>2. Put the file in Files, iCloud Drive or an email to yourself.</Text>
                <Text style={styles.step}>3. Choose it here.</Text>
                {problem ? <Text style={styles.error}>{problem}</Text> : null}
                <Pressable accessibilityRole="button" disabled={busy} style={[styles.primary, busy && styles.off]} onPress={pick}>
                    <Text style={styles.primaryText}>{busy ? 'Opening…' : 'Choose a studio file'}</Text>
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
            <Stack.Screen options={{ title: 'Film Studio' }} />
            <Text style={styles.title} accessibilityRole="header">{sum.name}</Text>
            <Text style={styles.muted}>
                {sum.aspect} · {sum.shots} {sum.shots === 1 ? 'shot' : 'shots'} · {sum.lockedAssets} of {sum.assets} assets locked · {sum.acceptedShots} takes accepted
            </Text>
            <Text style={styles.body}>{t('filmCloud.intro')}</Text>
            <Text style={styles.muted}>Opened {savedAt ? new Date(savedAt).toLocaleDateString() : 'from your account'}. You can edit every stage on this phone and save it back to your account.</Text>

            <Pressable accessibilityRole="button" style={styles.primary} onPress={() => router.push('/film/workspace')}>
                <Text style={styles.primaryText}>Edit in Film Studio</Text>
            </Pressable>

            <Text style={styles.heading} accessibilityRole="header">Stages</Text>
            {stages.map((s, i) => (
                <View key={s.id} style={styles.row} accessible accessibilityLabel={`Stage ${i + 1}, ${s.title}, ${s.done ? 'done' : `${s.open} to fix`}`}>
                    <Text style={styles.name}>
                        {s.done ? '✓' : '•'} {i + 1}. {s.title}
                    </Text>
                    {s.done ? null : (
                        <>
                            <Text style={styles.muted}>{s.open} to fix. {s.first}</Text>
                            <Text style={styles.web}>Open the native workspace</Text>
                        </>
                    )}
                </View>
            ))}

            <Text style={styles.heading} accessibilityRole="header">Shots</Text>
            {rows.length === 0 ? <Text style={styles.muted}>No shots yet. Add them in the breakdown on the web.</Text> : null}
            {rows.map((r) => (
                <Pressable key={r.shot.id} accessibilityRole="button" accessibilityLabel={`${r.shot.id}, ${r.label}`} style={[styles.row, touchTarget]} onPress={() => router.push({ pathname: '/film/shot/[id]', params: { id: r.shot.id } })}>
                    <Text style={styles.name}>{r.shot.id}</Text>
                    <Text style={styles.muted}>{String(r.shot.description).slice(0, 110)}</Text>
                    <Text style={r.state === 'accepted' ? styles.good : r.state === 'prompt-ready' ? styles.ready : styles.muted}>{r.label}</Text>
                </Pressable>
            ))}

            <Pressable accessibilityRole="button" disabled={busy} style={[styles.secondary, busy && styles.off]} onPress={pick}>
                <Text style={styles.secondaryText}>{busy ? 'Opening…' : 'Open a newer export'}</Text>
            </Pressable>
            {problem ? <Text style={styles.error}>{problem}</Text> : null}
            <Pressable accessibilityRole="button" style={[styles.secondary, touchTarget]} onPress={remove}>
                <Text style={styles.secondaryText}>Remove from this phone</Text>
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
            <Pressable accessibilityRole="button" style={[styles.row, touchTarget]} onPress={() => router.push('/library/files')}>
                <Text style={styles.name}>Film masters</Text>
                <Text style={styles.muted}>Your saved 16:9 masters. Share one or save it to Photos.</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={[styles.row, touchTarget]} onPress={() => router.push('/chat/new')}>
                <Text style={styles.name}>Film chats</Text>
                <Text style={styles.muted}>Seven helpers for setup, breakdown, references, passports, stress tests and prompts.</Text>
            </Pressable>
            <Pressable accessibilityRole="link" style={[styles.row, touchTarget]} onPress={() => WebBrowser.openBrowserAsync(`${API_BASE}${FILM_STUDIO_WEB_PATH}`)}>
                <Text style={styles.name}>Continue on web</Text>
                <Text style={styles.muted}>Open the desktop workspace when you want more room, while the native workspace remains fully editable.</Text>
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
    step: { color: colors.body, fontSize: 15 },
    muted: { color: colors.muted, fontSize: 13 },
    error: { color: colors.danger },
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
    off: { opacity: 0.4 },
});
