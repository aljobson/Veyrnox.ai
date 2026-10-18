import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { FreeAllowanceCard } from '../../../components/FreeAllowanceCard';
import { fetchCatalogCached, kindOf, type CatalogModel, type Kind } from '../../../lib/media';
import { selectedState } from '../../../lib/a11y';
import { fetchAgentListing } from '../../../lib/montage';
import { colors } from '../../../theme';
import { plural, t } from '../../../lib/i18n';

const KINDS: { kind: Kind; label: string }[] = [
    { kind: 'image', label: 'model.media.image' },
    { kind: 'video', label: 'model.media.video' },
    { kind: 'audio', label: 'model.media.audio' },
];

export default function Create() {
    const router = useRouter();
    const [models, setModels] = useState<CatalogModel[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [kind, setKind] = useState<Kind>('image');
    const [agent, setAgent] = useState<{ readonly credits: number } | null>(null);

    useEffect(() => {
        // Browsing the list works from a saved copy; the next screen loads the live catalog and prices.
        fetchCatalogCached((list) => setModels(list)).catch(() => setFailed(true));
        fetchAgentListing().then(setAgent);
    }, []);

    const shown = useMemo(() => (models ?? []).filter((m) => kindOf(m.modality) === kind), [models, kind]);

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('label.Create') }} />
            <Pressable accessibilityRole="button" style={styles.templates} onPress={() => router.push('/create/presets')}>
                <Text style={styles.name}>{t('label.Templates')}</Text>
                <Text style={styles.muted}>{t('create.templatesHint')}</Text>
            </Pressable>
            {models ? <FreeAllowanceCard models={models} /> : null}
            <View style={styles.tabs}>
                {KINDS.map((k) => (
                    <Pressable key={k.kind} accessibilityRole="tab" accessibilityState={selectedState(kind === k.kind)} style={[styles.tab, kind === k.kind && styles.tabOn]} onPress={() => setKind(k.kind)}>
                        <Text style={[styles.tabText, kind === k.kind && styles.tabTextOn]}>{t(k.label)}</Text>
                    </Pressable>
                ))}
            </View>
            {failed ? (
                <Text style={styles.error}>{t('create.loadError')}</Text>
            ) : models === null ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <FlatList
                    data={shown}
                    ListHeaderComponent={
                        kind === 'video' && agent ? (
                            <Pressable accessibilityRole="button" style={styles.row} onPress={() => router.push('/create/agent')}>
                                <View style={styles.agentText}>
                                    <Text style={styles.name}>{t('create.agentTitle')}</Text>
                                    <Text style={styles.muted}>{t('create.agentHint')}</Text>
                                </View>
                                <Text style={styles.price}>{plural('create.agentFrom', agent.credits)}</Text>
                            </Pressable>
                        ) : undefined
                    }
                    keyExtractor={(m) => m.id}
                    ListEmptyComponent={<Text style={styles.muted}>{t('create.noModels', { kind: t(`model.media.${kind}`).toLowerCase() })}</Text>}
                    renderItem={({ item }) => (
                        <Pressable accessibilityRole="button" style={styles.row} onPress={() => router.push({ pathname: '/create/[modelId]', params: { modelId: item.id } })}>
                            <Text style={styles.name}>{item.name}</Text>
                            <Text style={styles.price}>{plural('create.from', item.credits)}</Text>
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
    tab: { flex: 1, minHeight: 44, justifyContent: 'center', paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
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
