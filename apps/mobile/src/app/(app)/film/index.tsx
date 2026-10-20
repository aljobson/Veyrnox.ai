import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Stack, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { API_BASE } from '../../../lib/api';
import { touchTarget } from '../../../lib/a11y';
import { FILM_STUDIO_WEB_PATH, MAX_FILM_BYTES, shotRows, stageStatuses, summarize, type Film } from '../../../lib/filmStudio';
import { clearStudio, loadStudio, saveStudio } from '../../../lib/filmStudioStore';
import { colors } from '../../../theme';

// ADR-0210: Film Studio on the phone, first slice. The web keeps no copy of a studio on the server, so a person exports
// it there (Film Studio → export JSON) and opens the file here. This screen only reads it.
export default function FilmStudio() {
    const router = useRouter();
    const [film, setFilm] = useState<Film | null>(null);
    const [loading, setLoading] = useState(true);
    const [savedAt, setSavedAt] = useState<number | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let live = true;
        loadStudio().then(
            (s) => {
                if (!live) return;
                setFilm(s?.film ?? null);
                setSavedAt(s?.savedAt ?? null);
                setLoading(false);
            },
            () => live && setLoading(false),
        );
        return () => {
            live = false;
        };
    }, []);

    const pick = useCallback(async () => {
        if (busy) return;
        setBusy(true);
        setProblem(null);
        try {
            const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true, multiple: false });
            if (res.canceled || !res.assets[0]) return;
            const asset = res.assets[0];
            if (typeof asset.size === 'number' && asset.size > MAX_FILM_BYTES) return setProblem('The studio file must be smaller than 1 MB.');
            const saved = await saveStudio(await new File(asset.uri).text());
            if (!saved.ok) return setProblem(saved.error);
            setFilm(saved.film);
            setSavedAt(Date.now());
        } catch {
            setProblem('That file could not be read. Try exporting it again from the web.');
        } finally {
            setBusy(false);
        }
    }, [busy]);

    const remove = useCallback(async () => {
        await clearStudio();
        setFilm(null);
        setSavedAt(null);
    }, []);

    if (loading) return <ActivityIndicator color={colors.accent} style={styles.center} />;

    if (!film) {
        return (
            <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
                <Stack.Screen options={{ title: 'Film Studio' }} />
                <Text style={styles.title} accessibilityRole="header">Open your film on the phone</Text>
                <Text style={styles.body}>Film Studio plans a film in seven stages. It is saved in the browser on veyrnox.ai, not on our servers, so the phone opens a copy of it.</Text>
                <Text style={styles.step}>1. On veyrnox.ai open Film Studio and export your studio as JSON.</Text>
                <Text style={styles.step}>2. Put the file in Files, iCloud Drive or an email to yourself.</Text>
                <Text style={styles.step}>3. Choose it here.</Text>
                {problem ? <Text style={styles.error}>{problem}</Text> : null}
                <Pressable accessibilityRole="button" disabled={busy} style={[styles.primary, busy && styles.off]} onPress={pick}>
                    <Text style={styles.primaryText}>{busy ? 'Opening…' : 'Choose a studio file'}</Text>
                </Pressable>
                <Links router={router} />
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
            <Text style={styles.muted}>A copy from {savedAt ? new Date(savedAt).toLocaleDateString() : 'the web'}. Changes are made on the web; open a newer export to update it.</Text>

            <Text style={styles.heading} accessibilityRole="header">Stages</Text>
            {stages.map((s, i) => (
                <View key={s.id} style={styles.row} accessible accessibilityLabel={`Stage ${i + 1}, ${s.title}, ${s.done ? 'done' : `${s.open} to fix`}`}>
                    <Text style={styles.name}>
                        {s.done ? '✓' : '•'} {i + 1}. {s.title}
                    </Text>
                    {s.done ? null : (
                        <>
                            <Text style={styles.muted}>{s.open} to fix. {s.first}</Text>
                            <Text style={styles.web}>Continue on web</Text>
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
            <Links router={router} />
        </ScrollView>
    );
}

function Links({ router }: { router: ReturnType<typeof useRouter> }) {
    return (
        <View style={styles.links}>
            <Pressable accessibilityRole="button" style={[styles.row, touchTarget]} onPress={() => router.push('/library/files')}>
                <Text style={styles.name}>Film masters</Text>
                <Text style={styles.muted}>Your saved 16:9 masters. Share one or save it to Photos.</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={[styles.row, touchTarget]} onPress={() => router.push('/chat/new')}>
                <Text style={styles.name}>Film chats</Text>
                <Text style={styles.muted}>Seven helpers in a new chat: setup, breakdown, references, passports, stress tests and prompts. They write; they never lock anything.</Text>
            </Pressable>
            <Pressable accessibilityRole="link" style={[styles.row, touchTarget]} onPress={() => WebBrowser.openBrowserAsync(`${API_BASE}${FILM_STUDIO_WEB_PATH}`)}>
                <Text style={styles.name}>Continue on web</Text>
                <Text style={styles.muted}>Reference boards, asset passports, stress tests, locking, prompt writing and the 16:9 master are on the web for now.</Text>
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
