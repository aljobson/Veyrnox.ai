import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { fetchPresets, groupByTheme, presetHref, presetPrice, themeTitle, type Preset } from '../../../lib/presets';
import { colors } from '../../../theme';

export default function Templates() {
    const router = useRouter();
    const params = useLocalSearchParams<{ unavailable?: string | string[] }>();
    const [presets, setPresets] = useState<Preset[] | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        fetchPresets().then(setPresets).catch(() => setFailed(true));
    }, []);

    const sections = useMemo(() => groupByTheme(presets ?? []).map((g) => ({ title: themeTitle(g.category), data: g.items })), [presets]);
    const unavailableId = Array.isArray(params.unavailable) ? params.unavailable[0] : params.unavailable;
    const unavailablePreset = presets?.find((p) => p.id === unavailableId);

    function open(p: Preset) {
        router.push(presetHref(p));
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: 'Templates' }} />
            {unavailableId ? (
                <Text style={styles.unavailable} accessibilityLiveRegion="assertive">
                    {unavailablePreset ? `${unavailablePreset.title} is not available right now.` : 'That template is not available right now.'}
                </Text>
            ) : null}
            {failed ? (
                <Text style={styles.error}>Could not load templates. Check your connection.</Text>
            ) : presets === null ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <SectionList
                    sections={sections}
                    keyExtractor={(p) => p.id}
                    stickySectionHeadersEnabled={false}
                    ListEmptyComponent={<Text style={styles.muted}>No templates available right now.</Text>}
                    renderSectionHeader={({ section }) => <Text style={styles.header} accessibilityRole="header">{section.title}</Text>}
                    renderItem={({ item }) => (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`${item.title}, ${presetPrice(item)}${item.available ? '' : ', not available right now'}`}
                            style={styles.row}
                            onPress={() => open(item)}
                        >
                            {item.posterUrl ? <Image source={{ uri: item.posterUrl }} style={styles.poster} contentFit="cover" /> : <View style={styles.poster} />}
                            <View style={styles.text}>
                                <Text style={styles.name}>
                                    {item.title}
                                    {item.isNew ? '  NEW' : ''}
                                </Text>
                                <Text style={styles.price}>{presetPrice(item)}</Text>
                                {!item.available ? <Text style={styles.unavailableText}>Not available right now</Text> : null}
                                {item.needs ? <Text style={styles.muted}>Needs: {item.needs}</Text> : null}
                            </View>
                        </Pressable>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16 },
    header: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1, paddingTop: 20, paddingBottom: 6 },
    row: { flexDirection: 'row', gap: 12, paddingVertical: 10, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    poster: { width: 64, height: 96, borderRadius: 8, backgroundColor: colors.surface },
    text: { flex: 1, gap: 3 },
    name: { color: colors.text, fontSize: 16 },
    price: { color: colors.money },
    unavailable: { color: colors.body, paddingTop: 16 },
    unavailableText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
    muted: { color: colors.muted, fontSize: 13 },
    error: { color: colors.danger, paddingTop: 16 },
});
