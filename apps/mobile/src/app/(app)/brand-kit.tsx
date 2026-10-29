import { Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { Action, Status, styles as shared } from '../../components/account/shared';
import { BrandKitEditor } from '../../components/brand/BrandKitEditor';
import { fetchBrandAssets, fetchKit, kitErrorKey, type BrandAsset, type KitState } from '../../lib/brandKit';
import { t } from '../../lib/i18n';
import { fetchWorkspaces, fetchProjects, type Project, type Workspace } from '../../lib/projects';
import { isAccountChanged } from '../../auth/sessionTask';
import type { ApiClient, ClientTask } from '../../lib/api';
import { colors, LIST_END_PADDING } from '../../theme';

// Brand kit and brand assets for a workspace (parity P7). Off on the server until the editor's shared tools are on:
// the routes then answer 404 and this says so.
export default function BrandKit() {
    const { api, beginSessionTask } = useAuth();
    const read = useRef(0), catalogRead = useRef(0), mounted = useRef(false), selected = useRef<string | null>(null);
    const [projects, setProjects] = useState<Project[] | null>(null);
    const [spaces, setSpaces] = useState<Workspace[] | null>(null);
    const [spaceId, setSpaceId] = useState<string | null>(null);
    const [state, setState] = useState<KitState | null>(null);
    const [assets, setAssets] = useState<{ list: BrandAsset[]; truncated: boolean } | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Adapt existing read helpers without changing their public API or recapturing the account.
    const scoped = useCallback((task: ClientTask): ApiClient => ({ ...api, request: (path, init) => api.request(path, init, { task }) }), [api]);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; read.current++; catalogRead.current++; };
    }, []);
    useEffect(() => {
        const task = beginSessionTask();
        let active = true;
        fetchWorkspaces(scoped(task)).then(list => {
            if (!active || !mounted.current || !task.current()) return;
            setSpaces(list);
            const id = (list.find(w => w.isDefault) ?? list[0])?.id ?? null;
            selected.current = id; setSpaceId(id);
        }, err => { if (active && mounted.current && task.current() && !isAccountChanged(err)) setError(t(kitErrorKey(err))); });
        return () => { active = false; };
    }, [scoped, beginSessionTask]);
    const load = useCallback(async (id: string) => {
        const task = beginSessionTask(), order = ++read.current;
        const live = () => mounted.current && task.current() && order === read.current && selected.current === id;
        catalogRead.current++;
        setState(null); setAssets(null); setProjects(null); setError(null);
        try {
            const [kit, a, p] = await Promise.all([
                fetchKit(api, id, { task }), fetchBrandAssets(api, id, { task }).catch(() => null), fetchProjects(scoped(task), id).catch(() => []),
            ]);
            if (!live()) return;
            setState(kit); setAssets(a ? { list: a.assets, truncated: a.truncated } : { list: [], truncated: false }); setProjects(p);
        } catch (err) { if (live() && !isAccountChanged(err)) setError(t(kitErrorKey(err))); }
    }, [api, scoped, beginSessionTask]);
    useEffect(() => { if (spaceId) void load(spaceId); return () => { read.current++; }; }, [spaceId, load]);
    const refreshCatalog = async () => {
        if (!spaceId) return;
        const id = spaceId, task = beginSessionTask(), order = ++catalogRead.current, parent = read.current;
        try {
            const a = await fetchBrandAssets(api, id, { task });
            if (mounted.current && task.current() && selected.current === id && parent === read.current && order === catalogRead.current) setAssets({ list: a.assets, truncated: a.truncated });
        } catch { /* Keep the last catalog on a transient refresh failure. */ }
    };

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Stack.Screen options={{ title: t('brand.title') }} />
            <Text style={shared.help}>{t('brand.intro')}</Text>
            {spaces && spaces.length > 1 ? (
                <View style={styles.chips} accessibilityRole="tablist">
                    {spaces.map((w) => (
                        <Pressable key={w.id} accessibilityRole="tab" accessibilityState={{ selected: w.id === spaceId }} onPress={() => { if (selected.current === w.id) return; selected.current = w.id; read.current++; setState(null); setSpaceId(w.id); }} style={[styles.chip, w.id === spaceId && styles.chipOn]}>
                            <Text style={{ color: colors.text }}>{w.name}</Text>
                        </Pressable>
                    ))}
                </View>
            ) : null}
            {spaces && spaces.length === 0 ? <Text style={shared.help}>{t('brand.noWorkspace')}</Text> : null}
            {error ? (
                <>
                    <Status text={error} error />
                    {spaceId ? <Action label={t('acct.mfa.retry')} onPress={() => void load(spaceId)} /> : null}
                </>
            ) : !state && spaceId ? (
                <ActivityIndicator color={colors.accent} accessibilityLabel={t('brand.loading')} />
            ) : null}
            {state && spaceId ? <BrandKitEditor key={spaceId} workspaceId={spaceId} state={state} onSaved={setState} catalog={assets} projects={projects} onCatalogChanged={() => void refreshCatalog()} /> : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: 16 + LIST_END_PADDING, gap: 16 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
    chipOn: { borderColor: colors.accent },
});
