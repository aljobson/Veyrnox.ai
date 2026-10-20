import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { MIN_TARGET } from '../../lib/a11y';
import { fetchRetentionList, readOf, setRetention, socialErrorKey, type FollowKind, type RetentionItem } from '../../lib/cinemaSocial';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

type State = 'loading' | 'ready' | 'closed' | { error: string };

// Saved titles, followed creators or followed series: one row each, tap to open the title, one button to take it off.
// A closed switch (CINEMA_RETENTION_ENABLED off) is a message, not an error.
export function SavedList({ kind }: { readonly kind: FollowKind }) {
    const { api } = useAuth();
    const router = useRouter();
    const [items, setItems] = useState<RetentionItem[]>([]);
    const [next, setNext] = useState<string | null>(null);
    const [state, setState] = useState<State>('loading');
    const [note, setNote] = useState<string | null>(null);
    const busy = useRef(false);
    const live = useRef(true);

    const load = useCallback(async (cursor: string | null) => {
        if (busy.current) return;
        busy.current = true;
        if (!cursor) setState('loading');
        const r = await readOf(() => fetchRetentionList(api, kind, cursor));
        busy.current = false;
        if (!live.current) return;
        if (r.kind === 'ok') {
            setItems((prev) => (cursor ? [...prev, ...r.value.items.filter((x) => !prev.some((y) => y.targetId === x.targetId))] : r.value.items));
            setNext(r.value.next);
            setState('ready');
        } else if (cursor) setNote(t(r.kind === 'error' ? r.key : 'cinemaSocial.closed.retention'));
        else setState(r.kind === 'closed' ? 'closed' : { error: r.key });
    }, [api, kind]);

    useEffect(() => {
        live.current = true;
        void load(null);
        return () => { live.current = false; };
    }, [load]);

    async function remove(item: RetentionItem) {
        setNote(null);
        try {
            await setRetention(api, kind, item.targetId, false, Crypto.randomUUID());
            setItems((prev) => prev.filter((x) => x.targetId !== item.targetId));
        } catch (err) {
            setNote(t(socialErrorKey(err)));
        }
    }

    if (state === 'loading') return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
    if (state === 'closed') return <View style={styles.center}><Text style={styles.muted}>{t('cinemaSocial.closed.retention')}</Text></View>;
    if (typeof state === 'object') {
        return (
            <Pressable accessibilityRole="button" style={styles.center} onPress={() => load(null)}>
                <Text style={styles.error}>{t(state.error)} {t('cinemaSocial.tapRetry')}</Text>
            </Pressable>
        );
    }
    if (items.length === 0) return <View style={styles.center}><Text style={styles.muted}>{t(`cinemaSocial.empty.${kind}`)}</Text></View>;
    return (
        <FlatList
            data={items}
            keyExtractor={(x) => x.targetId}
            contentContainerStyle={styles.list}
            onEndReached={() => next && load(next)}
            onEndReachedThreshold={0.6}
            ListHeaderComponent={note ? <Text style={styles.error} accessibilityRole="alert">{note}</Text> : undefined}
            renderItem={({ item }) => (
                <View style={styles.row}>
                    <Pressable accessibilityRole="button" style={styles.main} onPress={() => router.push({ pathname: '/cinema/[id]', params: { id: item.contentId } })}>
                        <Text style={styles.name} numberOfLines={2}>{kind === 'creator' ? item.creator : item.title}</Text>
                        {kind !== 'creator' && item.creator ? <Text style={styles.muted} numberOfLines={1}>{item.creator}</Text> : null}
                        {kind === 'creator' ? <Text style={styles.muted} numberOfLines={1}>{item.title}</Text> : null}
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={t(`cinemaSocial.remove.${kind}`, { name: kind === 'creator' ? item.creator : item.title })} style={styles.remove} onPress={() => remove(item)}>
                        <Text style={styles.removeText}>{t(`cinemaSocial.removeShort.${kind}`)}</Text>
                    </Pressable>
                </View>
            )}
        />
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    list: { padding: 12, gap: 10 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingLeft: 14 },
    main: { flex: 1, minHeight: MIN_TARGET, justifyContent: 'center', paddingVertical: 10, gap: 2 },
    name: { color: colors.text, fontSize: 16, fontWeight: '600' },
    muted: { color: colors.muted },
    error: { color: colors.danger },
    remove: { minHeight: MIN_TARGET, minWidth: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 14 },
    removeText: { color: colors.muted, fontWeight: '600' },
});
