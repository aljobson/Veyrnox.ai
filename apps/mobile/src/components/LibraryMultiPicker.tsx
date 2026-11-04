import { rawText } from '../lib/i18n/translate';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MIN_TARGET } from '../lib/a11y';
import type { ApiClient } from '../lib/api';
import { formatLocale, t } from '../lib/i18n';
import { libraryChoices } from '../lib/librarySource';
import { fetchCatalogCached, mediaApi, type CatalogModel, type Job, type JobPage } from '../lib/media';
import type { SlotKind } from '../lib/sources';
import { colors } from '../theme';

export interface LibraryPick {
    readonly jobId: string;
    readonly name: string;
    readonly kind: SlotKind;
}

interface Props {
    readonly api: ApiClient;
    // Most of each kind the current model takes. A kind at 0 is not offered.
    readonly capacity: Readonly<Record<SlotKind, number>>;
    readonly onConfirm: (picks: LibraryPick[]) => void;
    readonly onClose: () => void;
}

const KINDS: SlotKind[] = ['image', 'video', 'audio'];
const LABEL: Record<SlotKind, 'app.create.addFiles.images' | 'app.create.addFiles.videos' | 'app.create.addFiles.audios'> = {
    image: 'app.create.addFiles.images', video: 'app.create.addFiles.videos', audio: 'app.create.addFiles.audios',
};

// The Add files picker's "Generated" tab (web AddFilesDialog): finished creations of any kind the model takes, picked
// several at a time in the order chosen, with a count for each kind so nobody picks more than the model can use.
export function LibraryMultiPicker({ api, capacity, onConfirm, onClose }: Props) {
    const [jobs, setJobs] = useState<Job[] | null>(null);
    const [next, setNext] = useState<JobPage['next']>(null);
    const [models, setModels] = useState<CatalogModel[]>([]);
    const [failed, setFailed] = useState(false);
    const [filter, setFilter] = useState<SlotKind | 'all'>('all');
    const [picked, setPicked] = useState<string[]>([]);
    const loading = useRef(false);
    const kinds = KINDS.filter((kind) => capacity[kind] > 0);

    async function load(cursor?: JobPage['next']) {
        if (loading.current) return;
        loading.current = true;
        try {
            const page = await mediaApi(api).listJobs(cursor ?? undefined);
            setJobs((j) => [...(j ?? []), ...page.jobs]);
            setNext(page.next);
        } catch {
            setFailed(true);
        } finally {
            loading.current = false;
        }
    }
    useEffect(() => {
        void load();
        fetchCatalogCached((list) => setModels(list)).catch(() => setFailed(true));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when opened
    }, []);

    const items = useMemo(() => kinds.flatMap((kind) => libraryChoices(jobs ?? [], models, kind).map((c) => ({ ...c, kind }))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [jobs, models, capacity]); // eslint-disable-line react-hooks/exhaustive-deps
    const byId = useMemo(() => new Map(items.map((i) => [i.jobId, i])), [items]);
    const chosen = picked.map((id) => byId.get(id)).filter((i): i is NonNullable<typeof i> => !!i);
    const count = (kind: SlotKind) => chosen.filter((i) => i.kind === kind).length;
    const shown = items.filter((i) => filter === 'all' || i.kind === filter);

    function toggle(id: string, kind: SlotKind) {
        setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : count(kind) < capacity[kind] ? [...prev, id] : prev));
    }

    return (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <View style={styles.sheet} onAccessibilityEscape={onClose}>
                <View style={styles.bar}>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('app.create.addFiles.cancel')} style={styles.side} onPress={onClose}><Text style={styles.action}>{t('app.create.addFiles.cancel')}</Text></Pressable>
                    <Text style={styles.title} accessibilityRole="header">{t('app.create.addFiles.title')}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('app.create.addFiles.add')} accessibilityState={{ disabled: !chosen.length }} disabled={!chosen.length} style={styles.side} onPress={() => onConfirm(chosen.map(({ jobId, name, kind }) => ({ jobId, name, kind })))}>
                        <Text style={[styles.action, !chosen.length && styles.off]}>{t('app.create.addFiles.add')}</Text>
                    </Pressable>
                </View>
                <View style={styles.chips}>
                    <Pressable accessibilityRole="button" accessibilityState={{ selected: filter === 'all' }} style={[styles.chip, filter === 'all' && styles.chipOn]} onPress={() => setFilter('all')}><Text style={styles.chipText}>{t('app.create.addFiles.all')}</Text></Pressable>
                    {kinds.map((kind) => (
                        <Pressable key={kind} accessibilityRole="button" accessibilityState={{ selected: filter === kind }} style={[styles.chip, filter === kind && styles.chipOn]} onPress={() => setFilter(kind)}>
                            <Text style={styles.chipText}>{t(LABEL[kind])} {t('app.create.addFiles.count', { selected: count(kind), max: capacity[kind] })}</Text>
                        </Pressable>
                    ))}
                </View>
                {failed && !jobs ? (
                    <Text style={styles.error}>{t('app.create.addFiles.error')}</Text>
                ) : jobs === null ? (
                    <ActivityIndicator color={colors.accent} accessibilityLabel={t('app.create.addFiles.loading')} />
                ) : (
                    <FlatList
                        data={shown}
                        extraData={picked}
                        keyExtractor={(c) => c.jobId}
                        onEndReached={() => next && load(next)}
                        ListEmptyComponent={<Text style={styles.muted}>{t('app.create.addFiles.emptyGenerated')}</Text>}
                        ListFooterComponent={next ? <Pressable accessibilityRole="button" style={styles.more} onPress={() => load(next)}><Text style={styles.action}>{t('app.create.addFiles.older')}</Text></Pressable> : undefined}
                        renderItem={({ item }) => {
                            const order = picked.indexOf(item.jobId);
                            const full = order < 0 && count(item.kind) >= capacity[item.kind];
                            return (
                                <Pressable
                                    accessibilityRole="checkbox"
                                    accessibilityState={{ checked: order >= 0, disabled: full }}
                                    accessibilityLabel={rawText(t('app.create.addFiles.select', { name: item.name }))}
                                    disabled={full}
                                    style={[styles.row, full && styles.off]}
                                    onPress={() => toggle(item.jobId, item.kind)}
                                >
                                    <View style={[styles.badge, order >= 0 && styles.badgeOn]}><Text style={styles.badgeText}>{order >= 0 ? order + 1 : ''}</Text></View>
                                    <View style={styles.grow}>
                                        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                                        <Text style={styles.muted}>{t(LABEL[item.kind])} · {new Date(item.createdAt).toLocaleDateString(formatLocale())}</Text>
                                    </View>
                                </Pressable>
                            );
                        }}
                    />
                )}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    sheet: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 8 },
    bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TARGET },
    side: { minHeight: MIN_TARGET, minWidth: MIN_TARGET, justifyContent: 'center' },
    title: { color: colors.text, fontSize: 18, fontWeight: '700', flexShrink: 1 },
    action: { color: colors.accent, fontWeight: '700', fontSize: 16 },
    off: { opacity: 0.4 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
    chipOn: { borderColor: colors.accent },
    chipText: { color: colors.text, fontSize: 14, fontWeight: '600' },
    row: { minHeight: MIN_TARGET + 8, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    grow: { flex: 1, gap: 2 },
    badge: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    badgeOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    badgeText: { color: colors.background, fontSize: 13, fontWeight: '700' },
    name: { color: colors.text, fontSize: 16 },
    muted: { color: colors.muted, fontSize: 13 },
    more: { minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
    error: { color: colors.danger },
});
