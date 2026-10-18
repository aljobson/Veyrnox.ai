import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchCatalog, kindOf, type CatalogModel, type Kind } from '../../../lib/media';
import { fetchAgentListing } from '../../../lib/montage';
import { colors } from '../../../theme';

const KINDS: { kind: Kind; label: string }[] = [
    { kind: 'image', label: 'Image' },
    { kind: 'video', label: 'Video' },
    { kind: 'audio', label: 'Audio' },
];

export default function Create() {
    const router = useRouter();
    const [models, setModels] = useState<CatalogModel[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [kind, setKind] = useState<Kind>('image');
    const [agent, setAgent] = useState<{ readonly credits: number } | null>(null);

    useEffect(() => {
        fetchCatalog().then(setModels).catch(() => setFailed(true));
        fetchAgentListing().then(setAgent);
    }, []);

    const shown = useMemo(() => (models ?? []).filter((m) => kindOf(m.modality) === kind), [models, kind]);

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: 'Create' }} />
            <Pressable accessibilityRole="button" style={styles.templates} onPress={() => router.push('/create/presets')}>
                <Text style={styles.name}>Templates</Text>
                <Text style={styles.muted}>Start from a ready-made idea</Text>
            </Pressable>
            <View style={styles.tabs}>
                {KINDS.map((k) => (
                    <Pressable key={k.kind} accessibilityRole="button" style={[styles.tab, kind === k.kind && styles.tabOn]} onPress={() => setKind(k.kind)}>
                        <Text style={[styles.tabText, kind === k.kind && styles.tabTextOn]}>{k.label}</Text>
                    </Pressable>
                ))}
            </View>
            {failed ? (
                <Text style={styles.error}>Could not load models. Check your connection.</Text>
            ) : models === null ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={shown}
                    ListHeaderComponent={
                        kind === 'video' && agent ? (
                            <Pressable accessibilityRole="button" style={styles.row} onPress={() => router.push('/create/agent')}>
                                <View style={styles.agentText}>
                                    <Text style={styles.name}>Video from a brief</Text>
                                    <Text style={styles.muted}>See a plan and the price first</Text>
                                </View>
                                <Text style={styles.price}>from {agent.credits} credits</Text>
                            </Pressable>
                        ) : undefined
                    }
                    keyExtractor={(m) => m.id}
                    ListEmptyComponent={<Text style={styles.muted}>No {kind} models available in the app yet.</Text>}
                    renderItem={({ item }) => (
                        <Pressable accessibilityRole="button" style={styles.row} onPress={() => router.push({ pathname: '/create/[modelId]', params: { modelId: item.id } })}>
                            <Text style={styles.name}>{item.name}</Text>
                            <Text style={styles.price}>from {item.credits} {item.credits === 1 ? 'credit' : 'credits'}</Text>
                        </Pressable>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 12 },
    templates: { padding: 14, borderRadius: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, gap: 2 },
    tabs: { flexDirection: 'row', gap: 8 },
    tab: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    tabOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    tabText: { color: colors.body, fontWeight: '600' },
    tabTextOn: { color: colors.accentInk },
    row: { paddingVertical: 14, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    name: { color: colors.text, fontSize: 16, flexShrink: 1 },
    price: { color: colors.money },
    muted: { color: colors.muted },
    agentText: { flexShrink: 1, gap: 2 },
    error: { color: colors.danger },
});
