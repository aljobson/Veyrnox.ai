import { rawText } from '../../../lib/i18n/translate';
import { useFaceFiltersAvailable } from '../../../lib/useFaceFiltersAvailable';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { IconBadge, ListRow } from '../../../components/ui';
import { toolIcon } from '../../../lib/featureIcons';
import { plural, t } from '../../../lib/i18n';
import { fetchCatalogCached, type CatalogModel } from '../../../lib/media';
import { requiresSource, toolGroups, toolNeeds } from '../../../lib/toolDirectory';
import { colors, LIST_END_PADDING } from '../../../theme';

// Models that work on a file you already have, grouped by the job they do (the web's /tools page). Each opens the same
// Create form as any other model, where the file is chosen and the price is shown before Generate.
export default function CreateTools() {
    const faceAvailable = useFaceFiltersAvailable();
    const router = useRouter();
    const params = useLocalSearchParams<{ source?: string; mode?: string }>();
    const [models, setModels] = useState<CatalogModel[] | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        fetchCatalogCached((list) => setModels(list)).catch(() => setFailed(true));
    }, []);

    const source = params.source === 'image' || params.source === 'video' ? params.source : null;
    const groups = useMemo(() => toolGroups(source ? (models ?? []).filter((model) => requiresSource(model, source)) : (models ?? [])), [models, source]);
    const lead = params.mode === 'reference'
        ? t('tools.choosewhatyourreferenceshouldguideYou')
        : source === 'image'
            ? t('tools.choosewhattodowithyourphoto')
            : source === 'video'
                ? t('tools.choosewhattodowithyourvideo')
                : t('toolsDir.lead');

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
            <Stack.Screen options={{ title: t('toolsDir.title') }} />
            <Text style={styles.lead}>{lead}</Text>
            {source !== 'video' && faceAvailable ? (
                <ListRow
                    accessibilityLabel={t('faceFilters.title')}
                    leading={<IconBadge {...toolIcon('face-filters')} />}
                    title={t('faceFilters.title')}
                    subtitle={t('faceFilters.lead')}
                    style={styles.featured}
                    onPress={() => router.push('/face-filters')}
                />
            ) : null}
            {failed && !models ? (
                <Text style={styles.error}>{t('create.loadError')}</Text>
            ) : models === null ? (
                <ActivityIndicator color={colors.accent} />
            ) : groups.length === 0 ? (
                <Text style={styles.muted}>{t('toolsDir.empty')}</Text>
            ) : (
                groups.filter(g => g.key !== 'face-filters' || faceAvailable).map((g) => (
                    <View key={g.key} style={styles.group}>
                        <View style={styles.groupHead}>
                            <Text style={styles.groupTitle} accessibilityRole="header">{g.label}</Text>
                            <Text style={styles.muted}>{g.blurb}</Text>
                        </View>
                        {g.tools.map((m) => (
                            <ListRow
                                key={m.id}
                                accessibilityLabel={rawText(`${m.name}. ${t('toolsDir.needs', { what: toolNeeds(m) })}. ${plural('create.from', m.credits)}`)}
                                leading={<IconBadge {...toolIcon(g.key)} />}
                                title={m.name}
                                subtitle={t('toolsDir.needs', { what: toolNeeds(m) })}
                                trailing={<Text style={styles.price}>{plural('create.from', m.credits)}</Text>}
                                onPress={() => g.key === 'face-filters' ? router.push('/face-filters') : router.push({ pathname: '/create/[modelId]', params: { modelId: m.id } })}
                            />
                        ))}
                    </View>
                ))
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 24, paddingBottom: LIST_END_PADDING },
    lead: { color: colors.body, fontSize: 15, lineHeight: 22 },
    featured: { paddingHorizontal: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
    group: { gap: 2 },
    groupHead: { gap: 2, marginBottom: 4 },
    groupTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
    price: { color: colors.money, fontSize: 13, fontWeight: '600' },
    muted: { color: colors.muted, fontSize: 13 },
    error: { color: colors.danger },
});
