import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ApiClient } from '../../lib/api';
import { getCacheUser } from '../../lib/appCache';
import { MIN_TARGET } from '../../lib/a11y';
import { defaultWorkspace } from '../../lib/editorProjects';
import { fetchProjects, fetchWorkspaces, type Project, type Workspace } from '../../lib/projects';
import { observe } from '../../lib/network';
import { plural, t } from '../../lib/i18n';
import type { OddlingsProjects, SyncState } from '../../lib/oddlingsProjects';
import type { OddlingsRecord } from '../../lib/oddlingsAccountStore';
import { colors } from '../../theme';

export function ProjectChooser({ api, engine, record, onResult }: {
    api: ApiClient; engine: OddlingsProjects; record: OddlingsRecord | null; onResult: (state: SyncState) => void;
}) {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [workspace, setWorkspace] = useState('');
    const [projects, setProjects] = useState<Project[]>([]);
    const [name, setName] = useState(t('oddlingsProjects.defaultName'));
    const [busy, setBusy] = useState(false);
    const [blocked, setBlocked] = useState<string[]>([]);
    const [bring, setBring] = useState(true);
    useEffect(() => { setBring(true); }, [record?.recoverable?.from]);
    useEffect(() => {
        let live = true;
        const owner = getCacheUser();
        setBusy(true);
        void (async () => {
            // Saved's focus sync replays persisted creation intents; this effect loads chooser options.
            const first = await defaultWorkspace(api);
            const all = await observe(fetchWorkspaces(api));
            if (live && owner === getCacheUser()) { setWorkspaces(all); setWorkspace(first?.id ?? ''); }
        })().catch(error => { if (live && owner === getCacheUser()) onResult(engine.reportError(error)); })
            .finally(() => { if (live) setBusy(false); });
        return () => { live = false; };
    }, [api, engine]);
    useEffect(() => {
        if (!workspace) return;
        let live = true;
        const owner = getCacheUser();
        setBusy(true); setProjects([]); setBlocked([]);
        void observe(fetchProjects(api, workspace)).then(rows => { if (live && owner === getCacheUser()) setProjects(rows); })
            .catch(error => { if (live && owner === getCacheUser()) onResult(engine.reportError(error)); })
            .finally(() => { if (live) setBusy(false); });
        return () => { live = false; };
    }, [api, workspace]);
    async function choose(id: string) {
        const owner = getCacheUser(); setBusy(true);
        try {
            const result = await engine.choose(id, bring);
            if (owner !== getCacheUser()) return;
            if (result === 'other') setBlocked(old => [...old, id]);
            else onResult(result);
        } catch (error) { if (owner === getCacheUser()) onResult(engine.reportError(error)); }
        finally { setBusy(false); }
    }
    const button = (label: string, onPress: () => void, selected = false, disabled = busy, key = label) => (
        <Pressable key={key} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }}
            disabled={disabled} onPress={onPress} style={styles.button}><Text style={styles.text}>{label}</Text></Pressable>
    );
    return <View style={styles.container}>
        <Text accessibilityRole="header" style={styles.heading}>{t('oddlingsProjects.choose')}</Text>
        {busy ? <ActivityIndicator accessibilityLabel={t('oddlingsProjects.loading')} /> : null}
        {workspaces.length > 1 ? <View>
            <Text accessibilityRole="header" style={styles.heading}>{t('oddlingsProjects.workspace')}</Text>
            {workspaces.map(w => button(w.name, () => setWorkspace(w.id), workspace === w.id, busy, w.id))}
        </View> : null}
        {record?.recoverable ? <View>
            {button(plural('oddlingsProjects.bring', record.recoverable.items.length), () => setBring(true), bring)}
            {button(t('oddlingsProjects.startEmpty'), () => Alert.alert(t('oddlingsProjects.discardTitle'), t('oddlingsProjects.discardBody'), [
                { text: t('oddlings.saved.cancel'), style: 'cancel' },
                { text: t('oddlingsProjects.startEmpty'), style: 'destructive', onPress: () => { setBring(false); void engine.discardRecovery(); } },
            ]), !bring)}
        </View> : null}
        {projects.map(p => <View key={p.id}>
            {button(p.name, () => { void choose(p.id); }, record?.projectId === p.id, busy || blocked.includes(p.id))}
            {blocked.includes(p.id) ? <Text accessibilityLiveRegion="polite" style={styles.text}>{t('oddlingsProjects.other')}</Text> : null}
        </View>)}
        <TextInput accessibilityLabel={t('oddlingsProjects.name')} value={name} onChangeText={setName} maxLength={120} style={styles.input} />
        {button(t('oddlingsProjects.new'), () => {
            const owner = getCacheUser(); setBusy(true);
            void engine.newProject(workspace, name).then(result => { if (owner === getCacheUser()) onResult(result); })
                .catch(() => { if (owner === getCacheUser()) onResult('local'); }).finally(() => setBusy(false));
        }, false, busy || !workspace || !name.trim())}
        {record?.pendingCreate ? button(t('oddlingsProjects.startOver'), () => { void engine.startOver(); }, false, false) : null}
        <Text style={styles.text}>{t('oddlingsProjects.deleteAccount')}</Text>
        <Text style={styles.text}>{t('oddlingsProjects.emptyProject')}</Text>
    </View>;
}
const styles = StyleSheet.create({
    container: { gap: 8, marginBottom: 16 }, heading: { color: colors.text, fontWeight: '700', fontSize: 18 },
    button: { minHeight: MIN_TARGET, minWidth: MIN_TARGET, padding: 10, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
    text: { color: colors.body }, input: { minHeight: MIN_TARGET, color: colors.text, borderWidth: 1, borderColor: colors.border, padding: 10 },
});
