import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { touchTarget } from '../../../lib/a11y';
import { cleanProjectName, deleteProject, fetchHistory, fetchProject, mergeVersions, projectsErrorMessage, renameProject, restoreVersion, versionLabel, type Project, type Version } from '../../../lib/projects';
import { EDITOR_ENABLED } from '../../../lib/editorFlag';
import { t } from '../../../lib/i18n';
import { colors } from '../../../theme';

export default function ProjectDetail() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { api } = useAuth();
    const router = useRouter();
    const [project, setProject] = useState<Project | null>(null);
    const [versions, setVersions] = useState<Version[] | null>(null);
    const [next, setNext] = useState<number | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const loadingMore = useRef(false);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    async function saveName() {
        const name = cleanProjectName(renaming ?? '');
        if (!project || !name || busy) return setNote('Give the project a name of up to 120 characters.');
        setBusy(true);
        setNote(null);
        try {
            const updated = await renameProject(api, project.id, name, project.version);
            if (updated) setProject(updated);
            setRenaming(null);
        } catch (err) {
            setNote(projectsErrorMessage(err));
        } finally {
            setBusy(false);
        }
    }

    function confirmDelete() {
        if (!project) return;
        Alert.alert('Delete this project?', 'The project and its saved versions are removed. This cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                    setBusy(true);
                    try {
                        await deleteProject(api, project.id, project.version);
                        router.back();
                    } catch (err) {
                        setNote(projectsErrorMessage(err));
                        setBusy(false);
                    }
                },
            },
        ]);
    }

    function confirmRestore(v: Version) {
        if (!project) return;
        Alert.alert(`Restore version ${v.revision}?`, 'This saves a new version copied from it. Your other versions stay.', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Restore',
                onPress: async () => {
                    setBusy(true);
                    setNote(null);
                    try {
                        const current = versions?.[0]?.revision ?? project.version;
                        await restoreVersion(api, project.id, current, v.revision);
                        await load();
                    } catch (err) {
                        setNote(projectsErrorMessage(err));
                    } finally {
                        setBusy(false);
                    }
                },
            },
        ]);
    }

    const load = useCallback(async () => {
        setProblem(null);
        try {
            const [p, h] = await Promise.all([fetchProject(api, String(id)), fetchHistory(api, String(id))]);
            setProject(p);
            setVersions(h.versions);
            setNext(h.nextBefore);
        } catch (err) {
            setProblem(projectsErrorMessage(err));
        }
    }, [api, id]);

    useEffect(() => {
        void load();
    }, [load]);

    async function more() {
        if (next === null || loadingMore.current || !versions) return;
        loadingMore.current = true;
        try {
            const h = await fetchHistory(api, String(id), next);
            const merged = mergeVersions(versions, h.versions);
            setVersions(merged.versions);
            // A page that adds nothing stops paging, even if a server ignored the cursor.
            setNext(merged.added ? h.nextBefore : null);
        } catch {
            setNext(null);
        } finally {
            loadingMore.current = false;
        }
    }

    if (problem) return <View style={styles.screen}><Stack.Screen options={{ title: 'Project' }} /><Pressable accessibilityRole="button" style={touchTarget} onPress={load}><Text style={styles.error}>{problem} Tap to retry.</Text></Pressable></View>;
    if (!project || !versions) return <View style={styles.screen}><Stack.Screen options={{ title: 'Project' }} /><ActivityIndicator color={colors.accent} /></View>;

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: project.name }} />
            {EDITOR_ENABLED && <Pressable accessibilityRole="button" accessibilityLabel={t('editor.open')} style={touchTarget} onPress={() => router.push({ pathname: '/editor/[projectId]', params: { projectId: project.id } })}><Text style={styles.name}>{t('editor.open')}</Text></Pressable>}
            {renaming !== null ? (
                <View style={styles.renameRow}>
                    <TextInput style={styles.input} value={renaming} onChangeText={setRenaming} accessibilityLabel="Project name" maxLength={120} autoFocus returnKeyType="done" onSubmitEditing={saveName} placeholderTextColor={colors.muted} />
                    <Pressable accessibilityRole="button" disabled={busy} style={[styles.go, touchTarget, busy && styles.off]} onPress={saveName}><Text style={styles.goText}>Save</Text></Pressable>
                </View>
            ) : (
                <View style={styles.actions}>
                    <Pressable accessibilityRole="button" disabled={busy} style={touchTarget} onPress={() => setRenaming(project.name)}><Text style={styles.action}>Rename</Text></Pressable>
                    <Pressable accessibilityRole="button" disabled={busy} style={touchTarget} onPress={confirmDelete}><Text style={styles.danger}>Delete</Text></Pressable>
                </View>
            )}
            {note ? <Text style={styles.error} accessibilityRole="alert">{note}</Text> : null}
            <Text style={styles.meta}>Version {project.version}{project.createdAt ? ` · created ${new Date(project.createdAt).toLocaleDateString()}` : ''}{project.updatedAt ? ` · updated ${new Date(project.updatedAt).toLocaleString()}` : ''}</Text>
            <Text style={styles.heading} accessibilityRole="header">Saved versions</Text>
            <FlatList
                data={versions}
                keyExtractor={(v) => String(v.revision)}
                onEndReached={more}
                onEndReachedThreshold={0.4}
                ListEmptyComponent={<Text style={styles.muted}>No saved versions yet.</Text>}
                ListFooterComponent={<Text style={styles.note}>The timeline is edited in the editor.</Text>}
                renderItem={({ item }) => (
                    <View style={styles.row}>
                        <View style={styles.rowText}>
                            <Text style={styles.name}>{versionLabel(item)}</Text>
                            {item.createdAt ? <Text style={styles.muted}>{new Date(item.createdAt).toLocaleString()}</Text> : null}
                        </View>
                        {item.revision !== versions[0]?.revision ? (
                            <Pressable accessibilityRole="button" accessibilityLabel={`Restore version ${item.revision}`} disabled={busy} style={[styles.restore, touchTarget]} onPress={() => confirmRestore(item)}>
                                <Text style={styles.action}>Restore</Text>
                            </Pressable>
                        ) : null}
                    </View>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 10 },
    meta: { color: colors.body },
    heading: { color: colors.muted, fontSize: 13, fontWeight: '700', letterSpacing: 0.5, marginTop: 8 },
    row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    rowText: { flexShrink: 1, gap: 2 },
    name: { color: colors.text, fontSize: 16 },
    muted: { color: colors.muted, fontSize: 13 },
    note: { color: colors.muted, fontSize: 13, paddingVertical: 20 },
    error: { color: colors.danger },
    actions: { flexDirection: 'row', gap: 20 },
    action: { color: colors.accent, fontSize: 16 },
    danger: { color: colors.danger, fontSize: 16 },
    renameRow: { flexDirection: 'row', gap: 8 },
    input: { flex: 1, color: colors.text, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, minHeight: 44 },
    go: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center' },
    goText: { color: colors.accentInk, fontWeight: '600' },
    off: { opacity: 0.4 },
    restore: { justifyContent: 'center' },
});
