import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { MIN_TARGET } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import type { Passport } from '../../../lib/oddlingsLibrary';
import { useAuth } from '../../../auth/AuthProvider';
import { getCacheUser, subscribeCacheUser } from '../../../lib/appCache';
import { oddlingsStore, subscribeOddlings, type OddlingsRecord } from '../../../lib/oddlingsAccountStore';
import { createOddlingsProjects, type SyncState } from '../../../lib/oddlingsProjects';
import { ProjectChooser } from '../../../components/oddlings/ProjectChooser';
import { colors } from '../../../theme';

export default function SavedPassports() {
    const router = useRouter();
    const { api } = useAuth();
    const engine = useMemo(() => createOddlingsProjects(api), [api]);
    const [owner, setOwner] = useState(getCacheUser());
    const [record, setRecord] = useState<OddlingsRecord | null>(null);
    const [state, setState] = useState<SyncState>('local');
    const [notice, setNotice] = useState<string | null>(null);
    const items = record?.local.items ?? [];
    useEffect(() => subscribeCacheUser(() => {
        setOwner(getCacheUser()); setRecord(null); setState('local'); setNotice(null);
    }), []);
    useFocusEffect(useCallback(() => {
        let live = true;
        const refresh = async () => {
            const next = await oddlingsStore.read();
            if (live && owner === getCacheUser()) setRecord(next);
        };
        const unsubscribe = subscribeOddlings(() => { void refresh(); });
        void refresh();
        void engine.syncNow().then(async result => {
            if (live && owner === getCacheUser()) {
                setState(result);
                const message = await engine.takeNotice();
                if (live && owner === getCacheUser() && message) setNotice(t(`oddlingsProjects.${message}`));
            }
        });
        return () => { live = false; unsubscribe(); };
    }, [engine, owner]));

    useEffect(() => {
        if (record?.notice) { setNotice(t(`oddlingsProjects.${record.notice}`)); void engine.takeNotice(); }
    }, [record?.notice, engine]);

    function confirmDelete(item: Passport) {
        Alert.alert(t('oddlings.saved.deleteTitle'), t('oddlings.saved.deleteBody'), [
            { text: t('oddlings.saved.cancel'), style: 'cancel' },
            { text: t('oddlings.saved.delete', { name: item.name }), style: 'destructive', onPress: () => { void oddlingsStore.remove(item.id, owner).then(() => engine.syncNow()).then(result => { if (owner === getCacheUser()) setState(result); }); } },
        ]);
    }

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('oddlings.saved.title') }} />
            <FlatList
                data={items}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.list}
                ListHeaderComponent={<View>
                    <Text accessibilityRole="header" style={styles.name}>{t('oddlings.saved.title')}</Text>
                    <Text accessibilityLiveRegion="polite" style={styles.empty}>{t(`oddlingsProjects.${state === 'unavailable' ? state : record?.blocked ? 'full' : state}`)}</Text>
                    {notice ? <Text accessibilityLiveRegion="polite" style={styles.empty}>{notice}</Text> : null}
                    {state !== 'unavailable' ? <ProjectChooser key={owner} api={api} engine={engine} record={record} onResult={setState} /> : null}
                </View>}
                ListEmptyComponent={<Text accessibilityLiveRegion="polite" style={styles.empty}>{t('oddlings.saved.empty')}</Text>}
                renderItem={({ item }) => {
                    const phoneOnly = !record?.projectId || record.ops.some(o => o.kind === 'upsert' && o.id === item.id);
                    return (
                        <View style={styles.card}>
                            <Pressable accessibilityRole="button" accessibilityLabel={t('oddlings.saved.edit', { name: item.name })}
                                accessibilityValue={phoneOnly ? { text: t('oddlingsProjects.phoneOnly') } : undefined}
                                accessibilityHint={phoneOnly ? t('oddlingsProjects.signOutHint') : undefined} style={styles.main} onPress={() => router.push({ pathname: '/oddlings/build', params: { passport: item.id } })}>
                                <Text style={styles.name}>{item.name}</Text>
                                <Text style={styles.sub} numberOfLines={2}>{item.picks.oddling_obsession || t('oddlings.saved.noPremise')}</Text>
                                {phoneOnly ?
                                    <Text style={styles.sub}>{t('oddlingsProjects.phoneOnly')}</Text> : null}
                                <Text style={styles.date}>{new Date(item.savedAt).toLocaleString()}</Text>
                            </Pressable>
                            <Pressable accessibilityRole="button" accessibilityLabel={t('oddlings.saved.delete', { name: item.name })} style={styles.del} onPress={() => confirmDelete(item)}>
                                <Text style={styles.delText}>✕</Text>
                            </Pressable>
                        </View>
                    );
                }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    list: { padding: 16, paddingBottom: VEY_CLEARANCE + 16, gap: 12 },
    empty: { color: colors.muted, textAlign: 'center', padding: 24 },
    card: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
    main: { flex: 1, padding: 14, minHeight: MIN_TARGET },
    name: { color: colors.text, fontSize: 17, fontWeight: '800' },
    sub: { color: colors.body, fontSize: 13, marginTop: 4 },
    date: { color: colors.muted, fontSize: 11, marginTop: 8 },
    del: { width: MIN_TARGET, minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
    delText: { color: colors.danger, fontSize: 18 },
});
