import { Text as StatusText } from '../../../components/ui/Text';
import { removeProjectMedia } from '../../../lib/editorDeviceMedia';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { ProjectDocumentCard } from '../../../components/projects/ProjectDocumentCard';
import { useBeginTask, useProjectDocument, useProjectHistory, type RestoreBlock, type Task } from '../../../components/projects/useProjectDocument';
import { VersionPreview } from '../../../components/projects/VersionPreview';
import { touchTarget } from '../../../lib/a11y';
import { getCacheUser, subscribeCacheUser } from '../../../lib/appCache';
import { cleanProjectName, deleteProject, fetchProject, projectsErrorMessage, renameProject, versionLabel, type Project, type Version } from '../../../lib/projects';
import { EDITOR_ENABLED } from '../../../lib/editorFlag';
import { formatLocale, t } from '../../../lib/i18n';
import { REVISION_CAP } from '../../../lib/projectDocumentDraft';
import { colors } from '../../../theme';

const changedAccount = (err: unknown) => (err as { code?: unknown } | null)?.code === 'account_changed';
function blockReason(block: RestoreBlock): string | null {
    if (block === 'dirty') return t('projectDocument.saveBeforeRestore');
    if (block === 'unsupported') return t('projectDocument.unsupported');
    if (block === 'revision_limit') return t('projectDocument.revisionLimit', { value1: REVISION_CAP });
    if (block === 'unloaded') return t('projectDocument.loadFailed');
    return null;
}

// Keyed by the signed-in owner, so another account never sees this one's in-memory draft.
export default function ProjectDetail() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const [owner, setOwner] = useState(getCacheUser());
    useEffect(() => subscribeCacheUser(() => setOwner(getCacheUser())), []);
    return <Detail key={`${owner}:${id}`} id={String(id)} />;
}

function Detail({ id }: { id: string }) {
    const { api } = useAuth();
    const beginTask = useBeginTask();
    const router = useRouter();
    const owner = useRef(getCacheUser());
    const mounted = useRef(true);
    useEffect(() => () => { mounted.current = false; }, []);
    const owned = useCallback((task?: Task) => mounted.current && getCacheUser() === owner.current && (!task || task.current()), []);
    const [project, setProject] = useState<Project | null>(null);
    const projectRef = useRef(project);
    projectRef.current = project;
    const [problem, setProblem] = useState<string | null>(null);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ text: string; reload: boolean } | null>(null);
    const [preview, setPreview] = useState<number | null>(null);
    const history = useProjectHistory(api, id, owned);
    const refreshHistory = history.refresh;
    const reloadProject = useCallback(async () => {
        const task = beginTask();
        try {
            const p = await fetchProject(api, id);
            if (owned(task) && p) setProject(p);
        } catch { /* The metadata line keeps what it showed. */ }
    }, [api, id, owned, beginTask]);
    const doc = useProjectDocument({
        api, id,
        onSaved: () => void refreshHistory(),
        onRestored: () => {
            setPreview(null);
            void refreshHistory();
            void reloadProject();
        },
    });

    const load = useCallback(async () => {
        const task = beginTask();
        setProblem(null);
        try {
            const [p, failed] = await Promise.all([fetchProject(api, id), refreshHistory()]);
            if (!owned(task)) return;
            if (failed) throw failed;
            setProject(p);
        } catch (err) {
            if (owned(task) && !changedAccount(err)) setProblem(projectsErrorMessage(err));
        }
    }, [api, id, owned, beginTask, refreshHistory]);

    useEffect(() => {
        void load();
    }, [load]);

    function showError(err: unknown) {
        if (changedAccount(err)) return;
        setNote({ text: projectsErrorMessage(err), reload: (err as { status?: unknown }).status === 409 });
    }

    async function saveName() {
        const name = cleanProjectName(renaming ?? '');
        if (!project || !name || busy) return setNote({ text: t('projects.givetheprojectanameofup'), reload: false });
        const task = beginTask();
        setBusy(true);
        setNote(null);
        try {
            const updated = await renameProject(api, project.id, name, project.version);
            if (!owned(task)) return;
            if (updated) setProject(updated);
            setRenaming(null);
        } catch (err) {
            if (owned(task)) showError(err);
        } finally {
            if (owned()) setBusy(false);
        }
    }

    // After a rename or delete 409: fetch the latest project, keeping the typed name in the field.
    async function reloadLatest() {
        const task = beginTask();
        setBusy(true);
        try {
            const p = await fetchProject(api, id);
            if (!owned(task)) return;
            if (p) setProject(p);
            setNote(null);
        } catch (err) {
            if (owned(task)) showError(err);
        } finally {
            if (owned()) setBusy(false);
        }
    }

    function confirmDelete() {
        if (!project || doc.phase === 'saving' || doc.phase === 'restoring') return;
        Alert.alert(t('projects.deletethisproject'), t('projects.theprojectanditssavedversionsare'), [
            { text: t('projects.cancel'), style: 'cancel' },
            {
                text: t('projects.delete'),
                style: 'destructive',
                onPress: async () => {
                    // The Alert may have opened before a save or restore began, so check again now.
                    const lock = doc.beginDelete();
                    if (!lock) return;
                    const task = beginTask();
                    await lock.settled();
                    if (!owned()) return;
                    const current = projectRef.current;
                    if (!lock.holds() || !current || !task.current()) return doc.resume();
                    setBusy(true);
                    try {
                        await deleteProject(api, current.id, current.version);
                        if (!owned(task)) return;
                        doc.discard();
                        void removeProjectMedia(current.id).catch(() => undefined);
                        router.back();
                    } catch (err) {
                        if (!owned(task)) return;
                        doc.resume();
                        showError(err);
                        setBusy(false);
                    }
                },
            },
        ]);
    }

    function confirmRestore(v: Version) {
        Alert.alert(t('projects.restoreversion', { value1: v.revision }), t('projects.thissavesanewversioncopiedfrom'), [
            { text: t('projects.cancel'), style: 'cancel' },
            { text: t('projects.restore'), onPress: () => void doc.restore(v.revision) },
        ]);
    }

    // The editor is pushed on top of this screen, so its latest edit is saved before it opens.
    async function openEditor() {
        if (!project) return;
        const push = () => router.push({ pathname: '/editor/[projectId]', params: { projectId: project.id } });
        const next = await doc.flushForHandoff();
        if (next === 'stop' || !owned()) return;
        if (next === 'go') return push();
        Alert.alert(t('projectDocument.latestNotSaved'), undefined, [
            { text: t('projectDocument.keepEditing'), style: 'cancel' },
            { text: t('projectDocument.openWithout'), onPress: () => { doc.dropToHead(); push(); } },
        ]);
    }

    if (problem) return <View style={styles.screen}><Stack.Screen options={{ title: t('projects.project') }} /><Pressable accessibilityRole="button" style={touchTarget} onPress={load}><Text style={styles.error}>{t('projects.taptoretry', { value1: problem })}</Text></Pressable></View>;
    const versions = history.history?.versions;
    if (!project || !versions) return <View style={styles.screen}><Stack.Screen options={{ title: t('projects.project') }} /><ActivityIndicator color={colors.accent} /></View>;
    const headRevision = doc.head?.revision ?? versions[0]?.revision;
    const writing = doc.phase === 'saving' || doc.phase === 'restoring';
    const listBlock = doc.restoreBlock(-1);

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: project.name }} />
            <FlatList
                data={versions}
                keyExtractor={(v) => String(v.revision)}
                onEndReached={() => void history.more()}
                onEndReachedThreshold={0.4}
                ListHeaderComponent={
                    <View style={styles.header}>
                        {EDITOR_ENABLED && <Pressable accessibilityRole="button" accessibilityLabel={t('editor.open')} disabled={doc.phase === 'suspended'} style={touchTarget} onPress={() => void openEditor()}><Text style={styles.name}>{t('editor.open')}</Text></Pressable>}
                        <ProjectDocumentCard doc={doc} />
                        {renaming !== null ? (
                            <View style={styles.renameRow}>
                                <TextInput style={styles.input} value={renaming} onChangeText={setRenaming} accessibilityLabel={t('projects.projectname')} maxLength={120} autoFocus returnKeyType="done" onSubmitEditing={saveName} placeholderTextColor={colors.muted} />
                                <Pressable accessibilityRole="button" disabled={busy} style={[styles.go, touchTarget, busy && styles.off]} onPress={saveName}><Text style={styles.goText}>{t('projects.save')}</Text></Pressable>
                            </View>
                        ) : (
                            <View style={styles.actions}>
                                <Pressable accessibilityRole="button" disabled={busy} style={touchTarget} onPress={() => setRenaming(project.name)}><Text style={styles.action}>{t('projects.rename')}</Text></Pressable>
                                <Pressable accessibilityRole="button" disabled={busy || writing} accessibilityState={{ disabled: busy || writing }} style={touchTarget} onPress={confirmDelete}><Text style={styles.danger}>{t('projects.delete')}</Text></Pressable>
                            </View>
                        )}
                        {note ? <StatusText variant="inherit" style={styles.error} accessibilityRole="alert">{note.text}</StatusText> : null}
                        {note?.reload ? <Pressable accessibilityRole="button" accessibilityLabel={t('projectDocument.reloadLatest')} disabled={busy} style={touchTarget} onPress={() => void reloadLatest()}><Text style={styles.action}>{t('projectDocument.reloadLatest')}</Text></Pressable> : null}
                        <Text style={styles.meta}>{t('projects.version', { value1: project.version, value2: project.createdAt ? t('projects.created', { value1: new Date(project.createdAt).toLocaleDateString(formatLocale()) }) : '', value3: project.updatedAt ? t('projects.updated', { value1: new Date(project.updatedAt).toLocaleString(formatLocale()) }) : '' })}</Text>
                        <Text style={styles.heading} accessibilityRole="header">{t('projects.savedversions')}</Text>
                        {listBlock && listBlock !== 'current' && versions.length > 1 && !doc.dropped ? <Text style={styles.muted}>{blockReason(listBlock)}</Text> : null}
                        {listBlock === 'unloaded' && !doc.loading && !doc.dropped ? <Pressable accessibilityRole="button" accessibilityLabel={t('projectDocument.reloadText')} style={touchTarget} onPress={() => void doc.reload()}><Text style={styles.action}>{t('projectDocument.retry')}</Text></Pressable> : null}
                    </View>
                }
                ListEmptyComponent={<Text style={styles.muted}>{t('projects.nosavedversionsyet')}</Text>}
                ListFooterComponent={
                    <View>
                        {history.failed ? (
                            <View style={styles.actions}>
                                <StatusText variant="inherit" style={styles.error} accessibilityRole="alert">{t('projectDocument.olderFailed')}</StatusText>
                                <Pressable accessibilityRole="button" accessibilityLabel={t('projectDocument.retry')} style={touchTarget} onPress={history.retry}><Text style={styles.action}>{t('projectDocument.retry')}</Text></Pressable>
                            </View>
                        ) : null}
                        <Text style={styles.note}>{t('projects.thetimelineiseditedintheeditor')}</Text>
                    </View>
                }
                renderItem={({ item }) => {
                    const block = doc.restoreBlock(item.revision);
                    return (
                        <View style={styles.row}>
                            <Pressable accessibilityRole="button" accessibilityLabel={t('projectDocument.previewVersion', { value1: item.revision })} style={[styles.rowText, touchTarget]} onPress={() => setPreview(item.revision)}>
                                <Text style={styles.name}>{versionLabel(item)}</Text>
                                {item.createdAt ? <Text style={styles.muted}>{new Date(item.createdAt).toLocaleString(formatLocale())}</Text> : null}
                            </Pressable>
                            {item.revision !== headRevision ? (
                                <Pressable accessibilityRole="button" accessibilityLabel={t('projects.restoreversion2', { value1: item.revision })} accessibilityState={{ disabled: !!block }} disabled={!!block} style={[styles.restore, touchTarget, !!block && styles.off]} onPress={() => confirmRestore(item)}>
                                    <Text style={styles.action}>{t('projects.restore')}</Text>
                                </Pressable>
                            ) : null}
                        </View>
                    );
                }}
            />
            {preview !== null ? (
                <VersionPreview
                    api={api}
                    id={id}
                    revision={preview}
                    reason={blockReason(doc.restoreBlock(preview))}
                    canRestore={!doc.restoreBlock(preview)}
                    restoring={doc.phase === 'restoring'}
                    live={owned}
                    onRestore={() => void doc.restore(preview)}
                    onClose={() => setPreview(null)}
                />
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 10 },
    header: { gap: 10 },
    meta: { color: colors.body },
    heading: { color: colors.muted, fontSize: 13, fontWeight: '700', letterSpacing: 0.5, marginTop: 8 },
    row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    rowText: { flexShrink: 1, gap: 2 },
    name: { color: colors.text, fontSize: 16 },
    muted: { color: colors.muted, fontSize: 13 },
    note: { color: colors.muted, fontSize: 13, paddingVertical: 20 },
    error: { color: colors.danger, flexShrink: 1 },
    actions: { flexDirection: 'row', gap: 20, alignItems: 'center' },
    action: { color: colors.accent, fontSize: 16 },
    danger: { color: colors.danger, fontSize: 16 },
    renameRow: { flexDirection: 'row', gap: 8 },
    input: { flex: 1, color: colors.text, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, minHeight: 44 },
    go: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center' },
    goText: { color: colors.accentInk, fontWeight: '600' },
    off: { opacity: 0.4 },
    restore: { justifyContent: 'center' },
});
