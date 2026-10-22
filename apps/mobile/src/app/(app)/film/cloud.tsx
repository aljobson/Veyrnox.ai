import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { touchTarget } from '../../../lib/a11y';
import { getCacheUser, subscribeCacheUser } from '../../../lib/appCache';
import { cloudStatus, fetchCloudFilms, loadActiveStudio, openCloudFilm, type CloudFilm } from '../../../lib/filmCloud';
import { plural, t } from '../../../lib/i18n';
import { colors } from '../../../theme';

type State = 'loading' | 'list' | 'unavailable' | 'offline' | 'busy' | 'error';
const failureText = (reason: string) => t(reason === 'offline' ? 'net.offline' : reason === 'error' ? 'common.error' : `filmCloud.${reason}`);

export default function CloudFilms() {
    const { api } = useAuth();
    const router = useRouter();
    const [rows, setRows] = useState<CloudFilm[]>([]);
    const [state, setState] = useState<State>('loading');
    const [openingId, setOpeningId] = useState<string | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const generation = useRef(0);
    const operation = useRef(0);
    const opening = useRef(false);
    const controller = useRef<AbortController | null>(null);

    const reload = useCallback(async () => {
        const token = ++generation.current;
        const owner = getCacheUser();
        setRows([]);
        setState('loading');
        if (!owner) { setState('unavailable'); return; }
        try {
            const films = await fetchCloudFilms(api);
            if (token !== generation.current || owner !== getCacheUser()) return;
            setRows(films);
            setState('list');
        } catch (err) {
            if (token !== generation.current || owner !== getCacheUser()) return;
            const status = cloudStatus(err);
            setState(status === 'gone' ? 'unavailable' : status);
        }
    }, [api]);

    useEffect(() => {
        const unsubscribe = subscribeCacheUser(() => {
            ++operation.current;
            controller.current?.abort();
            opening.current = false;
            setOpeningId(null);
            setProblem(null);
            void reload();
        });
        void reload();
        return () => { unsubscribe(); ++generation.current; ++operation.current; controller.current?.abort(); };
    }, [reload]);

    async function choose(row: CloudFilm) {
        if (opening.current) return;
        opening.current = true;
        setOpeningId(row.id);
        setProblem(null);
        const token = ++operation.current;
        const owner = getCacheUser();
        const current = () => token === operation.current && owner === getCacheUser();
        const finish = () => { if (current()) { opening.current = false; setOpeningId(null); } };
        const open = async () => {
            if (!current()) return;
            controller.current = new AbortController();
            const result = await openCloudFilm(api, row.id, undefined, controller.current.signal);
            if (!current()) return;
            finish();
            if (result.ok) { router.dismissTo('/film'); return; }
            if (result.reason === 'switched') { setProblem(null); void reload(); return; }
            const message = failureText(result.reason);
            setProblem(message);
            AccessibilityInfo.announceForAccessibility(message);
            if (result.reason === 'gone') void reload();
        };
        try {
            const active = await loadActiveStudio();
            if (!current()) return;
            if (!active) { await open(); return; }
            Alert.alert(t('filmCloud.replaceTitle', { name: row.name }), t('filmCloud.replaceBody'), [
                { text: t('drafts.cancel'), style: 'cancel', onPress: finish },
                { text: t('filmCloud.replaceConfirm'), style: 'destructive', onPress: () => { void open(); } },
            ], { cancelable: true, onDismiss: finish });
        } catch {
            if (!current()) return;
            finish();
            const message = t('common.error');
            setProblem(message);
            AccessibilityInfo.announceForAccessibility(message);
        }
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('filmCloud.title') }} />
            <Text style={styles.heading} accessibilityRole="header">{t('filmCloud.heading')}</Text>
            <Text style={styles.body}>{t('filmCloud.note')}</Text>
            {state === 'loading' ? <ActivityIndicator accessibilityLabel={t('filmCloud.loading')} /> : null}
            {state === 'list' && rows.length === 0 ? <Text style={styles.body}>{t('filmCloud.empty')}</Text> : null}
            {state !== 'list' && state !== 'loading' ? <Text style={styles.body} accessibilityLiveRegion="polite">{failureText(state)}</Text> : null}
            {rows.map(row => {
                const shots = plural('filmCloud.shots', row.shotCount);
                const date = row.updatedAt ? new Date(row.updatedAt).toLocaleDateString() : '';
                return (
                    <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={t('filmCloud.rowLabel', { name: row.name, shots, date })}
                        accessibilityState={{ busy: openingId === row.id, disabled: openingId !== null }} disabled={openingId !== null}
                        style={[styles.row, touchTarget]} onPress={() => { void choose(row); }}>
                        <Text style={styles.name}>{row.name}</Text>
                        <Text style={styles.body}>{shots}{date ? ` · ${date}` : ''}</Text>
                        {openingId === row.id ? <Text style={styles.body}>{t('filmCloud.opening')}</Text> : null}
                    </Pressable>
                );
            })}
            {problem ? <Text style={styles.body} accessibilityLiveRegion="polite">{problem}</Text> : null}
            {state === 'busy' || problem === t('filmCloud.busy') ? (
                <Pressable accessibilityRole="button" accessibilityLabel={t('filmCloud.retry')} style={touchTarget} onPress={() => { setProblem(null); void reload(); }}>
                    <Text style={styles.name}>{t('filmCloud.retry')}</Text>
                </Pressable>
            ) : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 8, paddingBottom: 48 },
    heading: { color: colors.text, fontSize: 22, fontWeight: '700' },
    body: { color: colors.body, fontSize: 15 },
    name: { color: colors.text, fontSize: 16 },
    row: { paddingVertical: 12, gap: 3, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
});
