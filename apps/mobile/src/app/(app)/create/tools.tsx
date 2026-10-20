import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { touchTarget } from '../../../lib/a11y';
import { plural, t } from '../../../lib/i18n';
import { fetchCatalogCached, type CatalogModel } from '../../../lib/media';
import { toolGroups, toolNeeds } from '../../../lib/toolDirectory';
import { colors } from '../../../theme';

// Models that work on a file you already have, grouped by the job they do (the web's /tools page). Each opens the same
// Create form as any other model, where the file is chosen and the price is shown before Generate.
export default function CreateTools() {
    const router = useRouter();
    const [models, setModels] = useState<CatalogModel[] | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        fetchCatalogCached((list) => setModels(list)).catch(() => setFailed(true));
    }, []);

    const groups = useMemo(() => toolGroups(models ?? []), [models]);

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
            <Stack.Screen options={{ title: t('toolsDir.title') }} />
            <Text style={styles.lead}>{t('toolsDir.lead')}</Text>
            {failed && !models ? (
                <Text style={styles.error}>{t('create.loadError')}</Text>
            ) : models === null ? (
                <ActivityIndicator color={colors.accent} />
            ) : groups.length === 0 ? (
                <Text style={styles.muted}>{t('toolsDir.empty')}</Text>
            ) : (
                groups.map((g) => (
                    <View key={g.key} style={styles.group}>
                        <Text style={styles.groupTitle} accessibilityRole="header">{g.label}</Text>
                        <Text style={styles.muted}>{g.blurb}</Text>
                        {g.tools.map((m) => (
                            <Pressable
                                key={m.id}
                                accessibilityRole="button"
                                accessibilityLabel={`${m.name}. ${t('toolsDir.needs', { what: toolNeeds(m) })}. ${plural('create.from', m.credits)}`}
                                style={[styles.row, touchTarget]}
                                onPress={() => router.push({ pathname: '/create/[modelId]', params: { modelId: m.id } })}
                            >
                                <View style={styles.rowText}>
                                    <Text style={styles.name}>{m.name}</Text>
                                    <Text style={styles.muted}>{t('toolsDir.needs', { what: toolNeeds(m) })}</Text>
                                </View>
                                <Text style={styles.price}>{plural('create.from', m.credits)}</Text>
                            </Pressable>
                        ))}
                    </View>
                ))
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 16, paddingBottom: VEY_CLEARANCE },
    lead: { color: colors.body, fontSize: 15, lineHeight: 22 },
    group: { gap: 4 },
    groupTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    rowText: { flexShrink: 1, gap: 2 },
    name: { color: colors.text, fontSize: 16 },
    price: { color: colors.money },
    muted: { color: colors.muted, fontSize: 13 },
    error: { color: colors.danger },
});
