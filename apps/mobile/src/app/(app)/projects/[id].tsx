import { rawText } from '../../../lib/i18n/translate';
import { Text as StatusText } from '../../../components/ui/Text';
import * as Crypto from 'expo-crypto';
import { removeProjectMedia } from '../../../lib/editorDeviceMedia';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { touchTarget } from '../../../lib/a11y';
import { cleanProjectName, deleteProject, fetchHistory, fetchProject, mergeVersions, projectsErrorMessage, renameProject, restoreVersion, versionLabel, type Project, type Version } from '../../../lib/projects';
import { EDITOR_ENABLED } from '../../../lib/editorFlag';
import { formatLocale, t } from '../../../lib/i18n';
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
    // One key per restore target, so a retried tap does not save the copy twice.
    const restoreKeys = useRef(new Map<string, string>());
    const [renaming, setRenaming] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    async function saveName() {
        const name = cleanProjectName(renaming ?? '');
        if (!project || !name || busy) return setNote(t('projects.givetheprojectanameofup'));
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
        Alert.alert(t('projects.deletethisproject'), t('projects.theprojectanditssavedversionsare'), [
            { text: t('projects.cancel'), style: 'cancel' },
            {
                text: t('projects.delete'),
                style: 'destructive',
                onPress: async () => {
                    setBusy(true);
                    try {
                        await deleteProject(api, project.id, project.version);
                        void removeProjectMedia(project.id).catch(() => undefined);
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
        Alert.alert(t('projects.restoreversion', { value1: v.revision }), t('projects.thissavesanewversioncopiedfrom'), [
            { text: t('projects.cancel'), style: 'cancel' },
            {
                text: t('projects.restore'),
                onPress: async () => {
                    setBusy(true);
                    setNote(null);
                    try {
                        const current = versions?.[0]?.revision ?? project.version;
                        const slot = `${current}:${v.revision}`;
                        const key = restoreKeys.current.get(slot) ?? Crypto.randomUUID();
                        restoreKeys.current.set(slot, key);
                        await restoreVersion(api, project.id, current, v.revision, key);
                        restoreKeys.current.delete(slot);
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

    if (problem) return <View style={styles.screen}><Stack.Screen options={{ title: t('projects.project') }} /><Pressable accessibilityRole="button" style={touchTarget} onPress={load}><Text style={styles.error}>{t('projects.taptoretry', { value1: problem })}</Text></Pressable></View>;
    if (!project || !versions) return <View style={styles.screen}><Stack.Screen options={{ title: t('projects.project') }} /><ActivityIndicator color={colors.accent} /></View>;

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: project.name }} />
            {EDITOR_ENABLED && <Pressable accessibilityRole="button" accessibilityLabel={t('editor.open')} style={touchTarget} onPress={() => router.push({ pathname: '/editor/[projectId]', params: { projectId: project.id } })}><Text style={styles.name}>{t('editor.open')}</Text></Pressable>}
            {renaming !== null ? (
                <View style={styles.renameRow}>
                    <TextInput style={styles.input} value={renaming} onChangeText={setRenaming} accessibilityLabel={t('projects.projectname')} maxLength={120} autoFocus returnKeyType="done" onSubmitEditing={saveName} placeholderTextColor={colors.muted} />
                    <Pressable accessibilityRole="button" disabled={busy} style={[styles.go, touchTarget, busy && styles.off]} onPress={saveName}><Text style={styles.goText}>{t('projects.save')}</Text></Pressable>
                </View>
            ) : (
                <View style={styles.actions}>
                    <Pressable accessibilityRole="button" disabled={busy} style={touchTarget} onPress={() => setRenaming(project.name)}><Text style={styles.action}>{t('projects.rename')}</Text></Pressable>
                    <Pressable accessibilityRole="button" disabled={busy} style={touchTarget} onPress={confirmDelete}><Text style={styles.danger}>{t('projects.delete')}</Text></Pressable>
                </View>
            )}
            {note ? <StatusText variant="inherit" style={styles.error} accessibilityRole="alert">{note}</StatusText> : null}
            <Text style={styles.meta}>{t('projects.version', { value1: project.version, value2: project.createdAt ? t('projects.created', { value1: new Date(project.createdAt).toLocaleDateString(formatLocale()) }) : '', value3: project.updatedAt ? t('projects.updated', { value1: new Date(project.updatedAt).toLocaleString(formatLocale()) }) : '' })}</Text>
            <Text style={styles.heading} accessibilityRole="header">{t('projects.savedversions')}</Text>
            <FlatList
                data={versions}
                keyExtractor={(v) => String(v.revision)}
                onEndReached={more}
                onEndReachedThreshold={0.4}
                ListEmptyComponent={<Text style={styles.muted}>{t('projects.nosavedversionsyet')}</Text>}
                ListFooterComponent={<Text style={styles.note}>{t('projects.thetimelineiseditedintheeditor')}</Text>}
                renderItem={({ item }) => (
                    <View style={styles.row}>
                        <View style={styles.rowText}>
                            <Text style={styles.name}>{versionLabel(item)}</Text>
                            {item.createdAt ? <Text style={styles.muted}>{new Date(item.createdAt).toLocaleString(formatLocale())}</Text> : null}
                        </View>
                        {item.revision !== versions[0]?.revision ? (
                            <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('projects.restoreversion2', { value1: item.revision }))} disabled={busy} style={[styles.restore, touchTarget]} onPress={() => confirmRestore(item)}>
                                <Text style={styles.action}>{t('projects.restore')}</Text>
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
