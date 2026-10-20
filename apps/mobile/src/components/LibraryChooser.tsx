import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MIN_TARGET } from '../lib/a11y';
import type { ApiClient } from '../lib/api';
import { t } from '../lib/i18n';
import { libraryChoices, type LibraryChoice } from '../lib/librarySource';
import { fetchCatalogCached, mediaApi, type CatalogModel, type Job, type JobPage } from '../lib/media';
import type { SlotKind } from '../lib/sources';
import { colors } from '../theme';

interface Props {
    readonly api: ApiClient;
    readonly kind: SlotKind;
    readonly onPick: (choice: LibraryChoice) => void;
    readonly onClose: () => void;
}

// The person's own finished creations of one kind, newest first, to use as a file without downloading it again.
export function LibraryChooser({ api, kind, onPick, onClose }: Props) {
    const [jobs, setJobs] = useState<Job[] | null>(null);
    const [next, setNext] = useState<JobPage['next']>(null);
    const [models, setModels] = useState<CatalogModel[]>([]);
    const [failed, setFailed] = useState(false);
    const loading = useRef(false);

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

    const choices = useMemo(() => libraryChoices(jobs ?? [], models, kind), [jobs, models, kind]);

    return (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <View style={styles.sheet}>
                <View style={styles.bar}>
                    <Text style={styles.title} accessibilityRole="header">{t('libsrc.title')}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('oddlings.build.done')} style={styles.done} onPress={onClose}>
                        <Text style={styles.doneText}>{t('oddlings.build.done')}</Text>
                    </Pressable>
                </View>
                {failed && !jobs ? (
                    <Text style={styles.error}>{t('library.loadError')}</Text>
                ) : jobs === null ? (
                    <ActivityIndicator color={colors.accent} />
                ) : (
                    <FlatList
                        data={choices}
                        keyExtractor={(c) => c.jobId}
                        onEndReached={() => next && load(next)}
                        ListEmptyComponent={<Text style={styles.muted}>{t(next ? 'libsrc.emptyMore' : 'libsrc.empty', { kind: t(`libsrc.kind.${kind}`) })}</Text>}
                        ListFooterComponent={next ? <Pressable accessibilityRole="button" style={styles.more} onPress={() => load(next)}><Text style={styles.moreText}>{t('libsrc.older')}</Text></Pressable> : undefined}
                        renderItem={({ item }) => (
                            <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}, ${new Date(item.createdAt).toLocaleDateString()}`} style={styles.row} onPress={() => { onPick(item); onClose(); }}>
                                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                                <Text style={styles.muted}>{new Date(item.createdAt).toLocaleDateString()}</Text>
                            </Pressable>
                        )}
                    />
                )}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    sheet: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 8 },
    bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TARGET },
    title: { color: colors.text, fontSize: 18, fontWeight: '700', flexShrink: 1 },
    done: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 12 },
    doneText: { color: colors.accent, fontWeight: '700', fontSize: 16 },
    row: { minHeight: MIN_TARGET + 8, justifyContent: 'center', borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
    name: { color: colors.text, fontSize: 16 },
    muted: { color: colors.muted, fontSize: 13 },
    more: { minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
    moreText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
    error: { color: colors.danger },
});
