import { rawText } from '../../../lib/i18n/translate';
import { Text as StatusText } from '../../../components/ui/Text';
import { Icon, useAppearance } from '../../../components/ui';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { EmptyState } from '../../../components/EmptyState';
import { HeaderAction } from '../../../components/HeaderAction';
import { useAuth } from '../../../auth/AuthProvider';
import { useAssetLinks } from '../../../components/JobThumb';
import { ProjectThumb } from '../../../components/CreationThumbs';
import { removeProjectMedia } from '../../../lib/editorDeviceMedia';
import { removeProjectFonts } from '../../../lib/editorFontFiles';
import { touchTarget } from '../../../lib/a11y';
import { cleanProjectName, createProject, createProjectFolder, deleteProject, deleteProjectFolder, editingTimeSavedClock, fetchProjectFolders, fetchProjects, fetchWorkspaces, folderLabel, projectDates, projectsErrorMessage, renameProjectFolder, type Project, type ProjectFolder, type Workspace } from '../../../lib/projects';
import { EDITOR_ENABLED } from '../../../lib/editorFlag';
import { t } from '../../../lib/i18n';
import { colors, vividHue } from '../../../theme';

export default function Projects() {
    const { api } = useAuth();
    const links = useAssetLinks(api);
    const router = useRouter();
    const { scheme } = useAppearance();
    const folderTone = vividHue('purple', scheme);
    const projectTone = vividHue('blue', scheme);
    const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
    const [workspaceId, setWorkspaceId] = useState<string | null>(null);
    const [projects, setProjects] = useState<Project[] | null>(null);
    const [folders, setFolders] = useState<ProjectFolder[]>([]);
    const [folderFilter, setFolderFilter] = useState<string>('all');
    const [problem, setProblem] = useState<string | null>(null);
    const [naming, setNaming] = useState(false);
    const [newName, setNewName] = useState('');
    const [creating, setCreating] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [folderNaming, setFolderNaming] = useState(false);
    const [folderName, setFolderName] = useState('');
    const [folderRenaming, setFolderRenaming] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    // One key per attempt: tapping Create twice, or retrying after a dropped connection, makes one project.
    const createKey = useRef<string | null>(null);
    const folderCreateKey = useRef<string | null>(null);
    const folderCreatePayload = useRef<string | null>(null);

    async function create() {
        const name = cleanProjectName(newName);
        if (!name || !workspaceId || creating) return setFormError(t('projects.givetheprojectanameofup2'));
        setCreating(true);
        setFormError(null);
        createKey.current ??= Crypto.randomUUID();
        try {
            const made = await createProject(api, workspaceId, name, createKey.current);
            createKey.current = null;
            setNaming(false);
            setNewName('');
            if (made) router.push({ pathname: '/projects/[id]', params: { id: made.id } });
        } catch (err) {
            setFormError(projectsErrorMessage(err));
        } finally {
            setCreating(false);
        }
    }

    async function createFolder() {
        const name = cleanProjectName(folderName);
        if (!name || !workspaceId || creating) return setFormError(t('projects.folderNameRequired'));
        const parentId = folderFilter !== 'all' && folderFilter !== 'unfiled' ? folderFilter : null;
        const payload = JSON.stringify({ workspaceId, parentId, name });
        if (folderCreatePayload.current !== payload) {
            folderCreatePayload.current = payload;
            folderCreateKey.current = Crypto.randomUUID();
        }
        setCreating(true); setFormError(null);
        try {
            const made = await createProjectFolder(api, workspaceId, parentId, name, folderCreateKey.current!);
            folderCreateKey.current = null; folderCreatePayload.current = null; setFolderName(''); setFolderNaming(false);
            if (made) { setFolders((current) => [...current.filter((item) => item.id !== made.id), made]); setFolderFilter(made.id); }
        } catch (err) { setFormError(projectsErrorMessage(err)); }
        finally { setCreating(false); }
    }

    const selectedFolder = folders.find((folder) => folder.id === folderFilter) ?? null;
    const selectedFolderDepth = selectedFolder ? folderLabel(selectedFolder, folders).split(' / ').length : 0;
    async function saveFolderName() {
        const name = cleanProjectName(folderName);
        if (!name || !selectedFolder || creating) return setFormError(t('projects.folderNameRequired'));
        setCreating(true); setFormError(null);
        try {
            const updated = await renameProjectFolder(api, selectedFolder.id, name, selectedFolder.version);
            if (updated) setFolders((current) => current.map((item) => item.id === updated.id ? updated : item));
            setFolderRenaming(false); setFolderName('');
        } catch (err) { setFormError(projectsErrorMessage(err)); }
        finally { setCreating(false); }
    }
    function confirmDeleteFolder() {
        if (!selectedFolder || creating) return;
        Alert.alert(t('projects.deleteFolderQuestion'), t('projects.deleteFolderHelp'), [
            { text: t('projects.cancel'), style: 'cancel' },
            { text: t('projects.delete'), style: 'destructive', onPress: () => void removeFolder(selectedFolder) },
        ]);
    }
    async function removeFolder(folder: ProjectFolder) {
        setCreating(true); setFormError(null);
        try {
            await deleteProjectFolder(api, folder.id, folder.version);
            setFolders((current) => current.filter((item) => item.id !== folder.id)); setFolderFilter('all');
        } catch (err) { setFormError(projectsErrorMessage(err)); }
        finally { setCreating(false); }
    }

    function confirmDeleteProject(project: Project) {
        if (deletingId) return;
        Alert.alert(t('projects.deletethisproject'), t('projects.theprojectanditssavedversionsare'), [
            { text: t('projects.cancel'), style: 'cancel' },
            { text: t('projects.delete'), style: 'destructive', onPress: () => void removeProject(project) },
        ]);
    }

    async function removeProject(project: Project) {
        if (deletingId) return;
        setDeletingId(project.id); setFormError(null);
        try {
            await deleteProject(api, project.id, project.version);
            setProjects((current) => current?.filter((item) => item.id !== project.id) ?? current);
            void Promise.all([removeProjectMedia(project.id), removeProjectFonts(project.id)]).catch(() => undefined);
        } catch (err) { setFormError(projectsErrorMessage(err)); }
        finally { setDeletingId(null); }
    }

    const loadWorkspaces = useCallback(async () => {
        setProblem(null);
        try {
            const list = await fetchWorkspaces(api);
            setWorkspaces(list);
            setWorkspaceId((cur) => cur ?? (list.find((w) => w.isDefault) ?? list[0])?.id ?? null);
        } catch (err) {
            setProblem(projectsErrorMessage(err));
        }
    }, [api]);

    useEffect(() => {
        void loadWorkspaces();
    }, [loadWorkspaces]);

    // Bumped by Retry so a failed project fetch runs again; loadWorkspaces alone never changes workspaceId.
    const [projectsAttempt, setProjectsAttempt] = useState(0);
    const retry = useCallback(() => {
        setProblem(null);
        if (workspaceId) setProjectsAttempt((n) => n + 1);
        else void loadWorkspaces();
    }, [workspaceId, loadWorkspaces]);

    useEffect(() => {
        if (!workspaceId) return;
        let cancelled = false;
        setProjects(null);
        Promise.allSettled([fetchProjects(api, workspaceId), fetchProjectFolders(api, workspaceId)]).then(([projectResult, folderResult]) => {
            if (cancelled) return;
            if (projectResult.status === 'rejected') return setProblem(projectsErrorMessage(projectResult.reason));
            setProjects(projectResult.value);
            setFolders(folderResult.status === 'fulfilled' ? folderResult.value : []);
            setFolderFilter('all');
        });
        return () => {
            cancelled = true;
        };
    }, [api, workspaceId, projectsAttempt]);

    // Coming back from a project (renamed or deleted there) refreshes the list quietly, without the spinner.
    const firstFocus = useRef(true);
    useFocusEffect(
        useCallback(() => {
            if (firstFocus.current) { firstFocus.current = false; return; }
            if (!workspaceId) return;
            let live = true;
            Promise.allSettled([fetchProjects(api, workspaceId), fetchProjectFolders(api, workspaceId)]).then(([projectResult, folderResult]) => {
                if (!live || projectResult.status === 'rejected') return;
                const folderList = folderResult.status === 'fulfilled' ? folderResult.value : [];
                setProjects(projectResult.value); setFolders(folderList);
                setFolderFilter((current) => current === 'all' || current === 'unfiled' || folderList.some((folder) => folder.id === current) ? current : 'all');
            });
            return () => { live = false; };
        }, [api, workspaceId]),
    );

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('projects.projects'), ...(EDITOR_ENABLED ? { headerRight: () => <HeaderAction label={t('editor.new')} onPress={() => router.push('/editor/new')} /> } : {}) }} />
            {problem ? (
                <Pressable accessibilityRole="button" style={touchTarget} onPress={retry}>
                    <Text style={styles.error}>{t('projects.taptoretry', { value1: problem })}</Text>
                </Pressable>
            ) : !workspaces ? (
                <ActivityIndicator color={colors.accent} />
            ) : workspaces.length === 0 ? (
                <EmptyState title={t('projects.noWorkspacesTitle')} body={t('projects.youhavenoworkspacesyetOpenthe')} {...(EDITOR_ENABLED ? { actionLabel: t('projects.openEditor'), href: '/editor/new' as const } : {})} />
            ) : (
                <>
                    {workspaces.length > 1 ? (
                        <View style={styles.chips}>
                            {workspaces.map((w) => (
                                <Pressable key={w.id} accessibilityRole="button" accessibilityState={{ selected: w.id === workspaceId }} style={[styles.chip, w.id === workspaceId && styles.chipOn]} onPress={() => setWorkspaceId(w.id)}>
                                    <Text style={[styles.chipText, w.id === workspaceId && styles.chipTextOn]}>{w.name}</Text>
                                </Pressable>
                            ))}
                        </View>
                    ) : null}
                    <View style={styles.chips}>
                        <Pressable accessibilityRole="button" accessibilityState={{ selected: folderFilter === 'all' }} style={[styles.chip, folderFilter === 'all' && styles.chipOn]} onPress={() => setFolderFilter('all')}><Text style={[styles.chipText, folderFilter === 'all' && styles.chipTextOn]}>{t('projects.allFolders')}</Text></Pressable>
                        <Pressable accessibilityRole="button" accessibilityState={{ selected: folderFilter === 'unfiled' }} style={[styles.chip, folderFilter === 'unfiled' && styles.chipOn]} onPress={() => setFolderFilter('unfiled')}><Text style={[styles.chipText, folderFilter === 'unfiled' && styles.chipTextOn]}>{t('projects.unfiled')}</Text></Pressable>
                        {folders.map((folder) => <Pressable key={folder.id} accessibilityRole="button" accessibilityState={{ selected: folderFilter === folder.id }} style={[styles.chip, folderFilter === folder.id && styles.chipOn]} onPress={() => setFolderFilter(folder.id)}><Text style={[styles.chipText, folderFilter === folder.id && styles.chipTextOn]}>{folderLabel(folder, folders)}</Text></Pressable>)}
                    </View>
                    {selectedFolder ? <View style={styles.folderActions}><Text style={styles.muted}>{folderLabel(selectedFolder, folders)}</Text><Pressable accessibilityRole="button" style={touchTarget} onPress={() => { setFolderNaming(false); setFolderName(selectedFolder.name); setFolderRenaming(true); }}><Text style={styles.newText}>{t('projects.renameFolder')}</Text></Pressable><Pressable accessibilityRole="button" style={touchTarget} onPress={confirmDeleteFolder}><Text style={styles.deleteText}>{t('projects.deleteFolder')}</Text></Pressable></View> : null}
                    {folderRenaming ? <View style={styles.newBox}><TextInput style={styles.input} value={folderName} onChangeText={setFolderName} placeholder={t('projects.folderName')} placeholderTextColor={colors.muted} accessibilityLabel={t('projects.folderName')} maxLength={120} autoFocus returnKeyType="done" onSubmitEditing={saveFolderName} /><Pressable accessibilityRole="button" disabled={creating} style={[styles.go, touchTarget, creating && styles.off]} onPress={saveFolderName}><Text style={styles.goText}>{creating ? '…' : t('projects.save')}</Text></Pressable></View> : null}
                    {folderNaming ? <View style={styles.newBox}><TextInput style={styles.input} value={folderName} onChangeText={setFolderName} placeholder={t('projects.folderName')} placeholderTextColor={colors.muted} accessibilityLabel={t('projects.folderName')} maxLength={120} autoFocus returnKeyType="done" onSubmitEditing={createFolder} /><Pressable accessibilityRole="button" disabled={creating} style={[styles.go, touchTarget, creating && styles.off]} onPress={createFolder}><Text style={styles.goText}>{creating ? '…' : t('projects.create')}</Text></Pressable></View>
                        : <Pressable accessibilityRole="button" disabled={selectedFolderDepth >= 4} style={[styles.newRow, { backgroundColor: folderTone.fill, borderColor: folderTone.edge }, touchTarget, selectedFolderDepth >= 4 && styles.off]} onPress={() => { setFolderRenaming(false); setFolderName(''); setFolderNaming(true); }}><View style={[styles.actionIcon, { backgroundColor: folderTone.iconSurface }]}><Icon name="folderPlus" size={24} tint={folderTone.foreground} /></View><Text style={[styles.newActionText, { color: folderTone.foreground }]}>{t('projects.newFolder')}</Text><Icon name="caretRight" size={20} tint={folderTone.foreground} /></Pressable>}
                    {naming ? (
                        <View style={styles.newBox}>
                            <TextInput
                                style={styles.input}
                                value={newName}
                                onChangeText={setNewName}
                                placeholder={t('projects.projectname')}
                                placeholderTextColor={colors.muted}
                                accessibilityLabel={t('projects.projectname')}
                                maxLength={120}
                                autoFocus
                                returnKeyType="done"
                                onSubmitEditing={create}
                            />
                            <Pressable accessibilityRole="button" disabled={creating} style={[styles.go, touchTarget, creating && styles.off]} onPress={create}>
                                <Text style={styles.goText}>{creating ? '…' : t('projects.create')}</Text>
                            </Pressable>
                        </View>
                    ) : (
                        <Pressable accessibilityRole="button" style={[styles.newRow, { backgroundColor: projectTone.fill, borderColor: projectTone.edge }, touchTarget]} onPress={() => setNaming(true)}>
                            <View style={[styles.actionIcon, { backgroundColor: projectTone.iconSurface }]}><Icon name="slate" size={24} tint={projectTone.foreground} /></View>
                            <Text style={[styles.newActionText, { color: projectTone.foreground }]}>{t('projects.newproject')}</Text>
                            <Icon name="caretRight" size={20} tint={projectTone.foreground} />
                        </Pressable>
                    )}
                    {formError ? <StatusText variant="inherit" style={styles.error} accessibilityRole="alert">{formError}</StatusText> : null}
                    {!projects ? (
                        <ActivityIndicator color={colors.accent} />
                    ) : (
                        <FlatList
                            data={projects.filter((project) => folderFilter === 'all' || (folderFilter === 'unfiled' ? !project.folderId : project.folderId === folderFilter))}
                            keyExtractor={(p) => p.id}
                            ListEmptyComponent={<Text style={styles.muted}>{t('projects.noprojectsinthisworkspaceyet')}</Text>}
                            ListFooterComponent={<Text style={styles.note}>{t('projects.openaprojecttorenameitdelete')}</Text>}
                            renderItem={({ item }) => (
                                <View style={styles.row}>
                                    <Pressable accessibilityRole="button" accessibilityLabel={rawText(`${item.name}, ${projectDates(item)}`)} style={[styles.projectLink, touchTarget]} onPress={() => router.push({ pathname: '/projects/[id]', params: { id: item.id } })}>
                                        <ProjectThumb api={api} links={links} projectId={item.id} size={48} />
                                        <View style={styles.copy}>
                                            <Text style={styles.name}>{item.name}</Text>
                                            <Text style={styles.muted}>{projectDates(item)}</Text>
                                            {item.editingTimeSavedSeconds ? <Text style={styles.saved}>{t('projects.editingTimeSaved', { value1: editingTimeSavedClock(item.editingTimeSavedSeconds) })}</Text> : null}
                                        </View>
                                    </Pressable>
                                    <Pressable accessibilityRole="button" accessibilityLabel={rawText(`${t('projects.delete')} ${item.name}`)} disabled={deletingId !== null} style={[styles.deleteButton, touchTarget, deletingId !== null && styles.off]} onPress={() => confirmDeleteProject(item)}>
                                        <Text style={styles.deleteText}>{deletingId === item.id ? '…' : t('projects.delete')}</Text>
                                    </Pressable>
                                </View>
                            )}
                        />
                    )}
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 12 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
    projectLink: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
    copy: { flex: 1, gap: 2 },
    name: { color: colors.text, fontSize: 16 },
    muted: { color: colors.muted },
    saved: { color: colors.accent, fontSize: 13, fontWeight: '600' },
    note: { color: colors.muted, fontSize: 13, paddingVertical: 20 },
    error: { color: colors.danger },
    newRow: { minHeight: 64, width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, overflow: 'hidden' },
    actionIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
    newActionText: { flex: 1, fontSize: 16, fontWeight: '700' },
    newText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
    deleteText: { color: colors.danger, fontSize: 16, fontWeight: '600' },
    deleteButton: { minWidth: 72, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
    folderActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14 },
    newBox: { flexDirection: 'row', gap: 8 },
    input: { flex: 1, color: colors.text, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, minHeight: 44 },
    go: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center' },
    goText: { color: colors.accentInk, fontWeight: '600' },
    off: { opacity: 0.4 },
});
