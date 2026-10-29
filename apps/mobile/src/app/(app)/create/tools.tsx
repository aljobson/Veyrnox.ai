import { rawText } from '../../../lib/i18n/translate';
import { useFaceFiltersAvailable } from '../../../lib/useFaceFiltersAvailable';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Icon, IconBadge, Text, themedStyles, useThemedStyles } from '../../../components/ui';
import { toolIcon } from '../../../lib/featureIcons';
import { plural, t } from '../../../lib/i18n';
import { fetchCatalogCached, type CatalogModel } from '../../../lib/media';
import { TOOL_TASKS, requiresSource, toolGroups, toolNeeds, type ToolGroup } from '../../../lib/toolDirectory';
import { ds, LIST_END_PADDING } from '../../../theme';

const FACE = 'face-filters';
const FACE_TASK = TOOL_TASKS.find((task) => task.key === FACE);

// The web's /tools page on the phone: one card per job, in the web's order, with the job's models under it. A model
// row opens the Create form, where the file is chosen and Generate shows the exact cost. Face filters is one card
// that opens its own screen (the filters are chosen there), so it never repeats once per filter model.
export default function CreateTools() {
    const styles = useThemedStyles(sheets);
    const faceAvailable = useFaceFiltersAvailable();
    const router = useRouter();
    const params = useLocalSearchParams<{ source?: string; mode?: string }>();
    const [models, setModels] = useState<CatalogModel[] | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        fetchCatalogCached((list) => setModels(list)).catch(() => setFailed(true));
    }, []);

    const source = params.source === 'image' || params.source === 'video' ? params.source : null;
    const showFace = faceAvailable && source !== 'video';
    const groups = useMemo(() => {
        const found = toolGroups(source ? (models ?? []).filter((model) => requiresSource(model, source)) : (models ?? [])).filter((g) => g.key !== FACE);
        if (!showFace || !FACE_TASK) return found;
        // Face filters keeps its place in the web's order even when the saved catalog has no face models.
        const order = (key: string) => { const i = TOOL_TASKS.findIndex((task) => task.key === key); return i < 0 ? TOOL_TASKS.length : i; };
        const face: ToolGroup = { key: FACE, label: FACE_TASK.label, blurb: t('faceFilters.lead'), tools: [] };
        const at = found.findIndex((g) => order(g.key) > order(FACE));
        return at < 0 ? [...found, face] : [...found.slice(0, at), face, ...found.slice(at)];
    }, [models, source, showFace]);
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
            <Text variant="body" tone="secondary">{lead}</Text>
            {failed && !models ? (
                <Text variant="body" tone="danger">{t('create.loadError')}</Text>
            ) : models === null ? (
                <ActivityIndicator color={styles.accentInk.color} />
            ) : groups.length === 0 ? (
                <Text variant="footnote" tone="secondary">{t('toolsDir.empty')}</Text>
            ) : groups.map((g) => g.key === FACE ? (
                <Pressable key={g.key} accessibilityRole="button" accessibilityLabel={rawText(`${g.label}. ${g.blurb}`)} onPress={() => router.push('/face-filters')}
                    style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
                    <View style={styles.head}>
                        <IconBadge {...toolIcon(g.key)} />
                        <View style={styles.headText}>
                            <Text variant="bodyStrong" tone="primary" accessibilityRole="header">{g.label}</Text>
                            <Text variant="footnote" tone="secondary">{g.blurb}</Text>
                        </View>
                        <Icon name="caretRight" size={20} />
                    </View>
                </Pressable>
            ) : (
                <View key={g.key} style={styles.card}>
                    <View style={styles.head}>
                        <IconBadge {...toolIcon(g.key)} />
                        <View style={styles.headText}>
                            <Text variant="bodyStrong" tone="primary" accessibilityRole="header">{g.label}</Text>
                            <Text variant="footnote" tone="secondary">{g.blurb}</Text>
                        </View>
                    </View>
                    {g.tools.map((m) => (
                        <Pressable key={m.id} accessibilityRole="button"
                            accessibilityLabel={rawText(`${m.name}. ${t('toolsDir.needs', { what: toolNeeds(m) })}. ${plural('library.cost', m.credits)}`)}
                            onPress={() => router.push({ pathname: '/create/[modelId]', params: { modelId: m.id } })}
                            style={({ pressed }) => [styles.tool, pressed && styles.pressed]}>
                            <View style={styles.toolText}>
                                <Text variant="callout" tone="primary">{m.name}</Text>
                                <Text variant="footnote" tone="secondary">{t('toolsDir.needs', { what: toolNeeds(m) })}</Text>
                            </View>
                            <Text variant="footnote" tone="secondary" style={styles.price}>{plural('library.cost', m.credits)}</Text>
                            <Icon name="caretRight" size={16} />
                        </Pressable>
                    ))}
                </View>
            ))}
        </ScrollView>
    );
}

const sheets = themedStyles((p) => ({
    accentInk: { color: p.accent },
    screen: { flex: 1, backgroundColor: p.bg },
    body: { padding: ds.space.lg, gap: ds.space.md, paddingBottom: LIST_END_PADDING },
    card: { borderRadius: ds.radius.lg, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.bgElevated1, paddingHorizontal: ds.space.md, paddingVertical: ds.space.sm },
    pressed: { opacity: 0.7 },
    head: { flexDirection: 'row', alignItems: 'center', gap: ds.space.md, paddingVertical: ds.space.sm },
    headText: { flex: 1, gap: ds.space.xxs },
    tool: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: ds.space.sm, paddingVertical: ds.space.sm, borderTopWidth: 0.5, borderColor: p.borderSubtle },
    toolText: { flex: 1, gap: ds.space.xxs },
    price: { fontVariant: ['tabular-nums'] },
}));
