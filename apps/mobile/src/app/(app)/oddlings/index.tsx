import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { MIN_TARGET } from '../../../lib/a11y';
import { OddlingFilters } from '../../../components/oddlings/OddlingFilters';
import { plural, t } from '../../../lib/i18n';
import { portraitUrl, reconcileKind, toggleKind, visibleOddlings, type OddlingKind } from '../../../lib/oddlings';
import { colors } from '../../../theme';

export default function OddlingGallery() {
    const router = useRouter();
    const [tab, setTab] = useState('all');
    const [kind, setKind] = useState<OddlingKind | null>(null);
    const items = useMemo(() => visibleOddlings(tab, kind), [tab, kind]);

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('oddlings.title') }} />
            <FlatList
                data={items}
                numColumns={2}
                keyExtractor={(item) => item.id}
                columnWrapperStyle={styles.column}
                contentContainerStyle={styles.list}
                initialNumToRender={8}
                windowSize={5}
                ListHeaderComponent={
                    <View>
                        <Text style={styles.intro}>{t('oddlings.intro')}</Text>
                        <View style={styles.entries}>
                            <Pressable accessibilityRole="button" style={[styles.entry, styles.entryMain]} onPress={() => router.push('/oddlings/build')}>
                                <Text style={styles.entryMainText}>{t('oddlings.build.entry')}</Text>
                            </Pressable>
                            <Pressable accessibilityRole="button" style={styles.entry} onPress={() => router.push('/oddlings/saved')}>
                                <Text style={styles.entryText}>{t('oddlings.build.saved')}</Text>
                            </Pressable>
                        </View>
                        <OddlingFilters tab={tab} kind={kind} onTab={(id) => { setTab(id); setKind((k) => reconcileKind(id, k)); }} onKind={(id) => setKind((k) => toggleKind(k, id))} />
                        <Text style={styles.count} accessibilityLiveRegion="polite">{plural('oddlings.count', items.length)}</Text>
                    </View>
                }
                ListEmptyComponent={<Text style={styles.empty}>{t('oddlings.empty')}</Text>}
                renderItem={({ item }) => (
                    <Pressable accessibilityRole="button" accessibilityLabel={t('oddlings.card', { name: item.name })} style={styles.card} onPress={() => router.push({ pathname: '/oddlings/[id]', params: { id: item.id } })}>
                        <Image source={{ uri: portraitUrl(item.id) }} style={styles.portrait} contentFit="cover" cachePolicy="disk" recyclingKey={item.id} accessibilityIgnoresInvertColors />
                        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.accent} numberOfLines={1}>{item.accent}</Text>
                    </Pressable>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    list: { paddingBottom: 32 },
    column: { gap: 12, paddingHorizontal: 16 },
    intro: { color: colors.body, fontSize: 15, paddingHorizontal: 16, paddingTop: 12 },
    entries: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 12 },
    entry: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
    entryMain: { backgroundColor: colors.accent, borderColor: colors.accent },
    entryText: { color: colors.text, fontSize: 15, fontWeight: '600' },
    entryMainText: { color: colors.accentInk, fontSize: 15, fontWeight: '800' },
    count: { color: colors.muted, fontSize: 13, paddingHorizontal: 16, marginVertical: 12 },
    empty: { color: colors.muted, textAlign: 'center', padding: 24 },
    card: { flex: 1, marginBottom: 16 },
    portrait: { width: '100%', aspectRatio: 2 / 3, borderRadius: 12, backgroundColor: colors.surface },
    name: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 8 },
    accent: { color: colors.muted, fontSize: 11, letterSpacing: 1 },
});
