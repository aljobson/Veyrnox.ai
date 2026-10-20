import { Image } from 'expo-image';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { touchTarget } from '../lib/a11y';
import { fetchTitlesPage, posterUrl, type CinemaTitle } from '../lib/cinema';
import { t } from '../lib/i18n';
import { fetchPresets, presetPrice, type Preset } from '../lib/presets';
import { colors } from '../theme';

type Tab = 'templates' | 'cinema';

// Browse before an account: templates and the Cinema list, from public data only. Playing, creating and buying ask to sign
// in. A signed-in person has no use for this screen and is sent to the app.
export default function Preview() {
    const { status } = useAuth();
    const router = useRouter();
    const [tab, setTab] = useState<Tab>('templates');
    const [presets, setPresets] = useState<Preset[] | null>(null);
    const [titles, setTitles] = useState<CinemaTitle[] | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let alive = true;
        fetchPresets()
            .then((p) => alive && setPresets(p))
            .catch(() => alive && setFailed(true));
        fetchTitlesPage(null)
            .then((page) => alive && setTitles([...page.titles]))
            .catch(() => alive && setFailed(true));
        return () => {
            alive = false;
        };
    }, []);

    if (status === 'signedIn') return <Redirect href="/" />;

    const signIn = () => router.push('/sign-in');
    const loading = tab === 'templates' ? presets === null : titles === null;
    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('preview.title'), headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }} />
            <View style={styles.tabs}>
                {(['templates', 'cinema'] as const).map((k) => (
                    <Pressable
                        key={k}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: tab === k }}
                        style={[styles.tab, tab === k && styles.tabOn, touchTarget]}
                        onPress={() => setTab(k)}
                    >
                        <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{t(k === 'templates' ? 'preview.tab.templates' : 'preview.tab.cinema')}</Text>
                    </Pressable>
                ))}
            </View>
            <ScrollView contentContainerStyle={styles.body}>
                <Text style={styles.heading} accessibilityRole="header">{t(tab === 'templates' ? 'preview.templates.heading' : 'preview.cinema.heading')}</Text>
                {loading && !failed ? <ActivityIndicator color={colors.accent} /> : null}
                {failed && loading ? <Text style={styles.note}>{t('preview.error')}</Text> : null}
                {tab === 'templates'
                    ? (presets ?? []).slice(0, 30).map((p) => (
                          <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`${p.title}, ${presetPrice(p)}`} accessibilityHint={t('preview.signInHint')} style={styles.card} onPress={signIn}>
                              {p.posterUrl ? <Image source={{ uri: p.posterUrl }} style={styles.poster} contentFit="cover" accessibilityIgnoresInvertColors /> : <View style={styles.poster} />}
                              <Text style={styles.cardTitle} numberOfLines={2}>{p.title}</Text>
                              <Text style={styles.cardMeta}>{presetPrice(p)}</Text>
                          </Pressable>
                      ))
                    : (titles ?? []).map((c) => (
                          <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={c.title} accessibilityHint={t('preview.signInHint')} style={styles.card} onPress={signIn}>
                              <Image source={{ uri: posterUrl(c.id) }} style={styles.poster} contentFit="cover" accessibilityIgnoresInvertColors />
                              <Text style={styles.cardTitle} numberOfLines={2}>{c.title}</Text>
                              {c.creator ? <Text style={styles.cardMeta}>{c.creator}</Text> : null}
                          </Pressable>
                      ))}
            </ScrollView>
            <View style={styles.footer}>
                <Text style={styles.note}>{t('preview.footer')}</Text>
                <Pressable accessibilityRole="button" style={[styles.primary, touchTarget]} onPress={signIn}>
                    <Text style={styles.primaryText}>{t('preview.signIn')}</Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    tabs: { flexDirection: 'row', gap: 8, padding: 16, paddingBottom: 0 },
    tab: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center' },
    tabOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    tabText: { color: colors.text, fontSize: 16, fontWeight: '600' },
    tabTextOn: { color: colors.accentInk },
    body: { padding: 16, gap: 12 },
    heading: { color: colors.text, fontSize: 20, fontWeight: '700' },
    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
    poster: { height: 160, backgroundColor: colors.border },
    cardTitle: { color: colors.text, fontSize: 16, fontWeight: '600', padding: 10, paddingBottom: 2 },
    cardMeta: { color: colors.money, fontSize: 14, paddingHorizontal: 10, paddingBottom: 10 },
    note: { color: colors.body, fontSize: 15, lineHeight: 22 },
    footer: { padding: 16, gap: 8, borderTopWidth: 1, borderTopColor: colors.border },
    primary: { backgroundColor: colors.accent, borderRadius: 12, alignItems: 'center', paddingHorizontal: 16 },
    primaryText: { color: colors.accentInk, fontSize: 17, fontWeight: '700' },
});
