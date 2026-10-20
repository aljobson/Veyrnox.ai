import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { MIN_TARGET } from '../../lib/a11y';
import { createRetentionLifecycle, createRetentionList, emptyRetentionList, retentionDisabled, setRetention, socialErrorKey, type FollowKind, type RetentionItem } from '../../lib/cinemaSocial';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

// Saved titles, followed creators or followed series: one row each, tap to open the title, one button to take it off.
// A closed switch (CINEMA_RETENTION_ENABLED off) is a message, not an error.
export function SavedList({ kind }: { readonly kind: FollowKind }) {
    const { api, status } = useAuth();
    const router = useRouter();
    const [view, setView] = useState(emptyRetentionList);
    const [note, setNote] = useState<string | null>(null);
    const [removing, setRemoving] = useState(false);
    const list = useRef<ReturnType<typeof createRetentionList> | null>(null);
    const lifecycle = useRef<ReturnType<typeof createRetentionLifecycle> | null>(null);

    useEffect(() => {
        const scope = createRetentionLifecycle(api, status);
        lifecycle.current = scope;
        setRemoving(false);
        const current = scope.start(() => createRetentionList(api, kind, (next) => { setView(next); setNote(null); }));
        list.current = current ?? null;
        void current?.reload();
        return () => { scope.dispose(); current?.dispose(); list.current = null; lifecycle.current = null; };
    }, [api, kind, status]);

    async function remove(item: RetentionItem) {
        await lifecycle.current?.write(
            () => setRetention(api, kind, item.targetId, false, Crypto.randomUUID()),
            {
                busy: (active) => { setRemoving(active); if (active) setNote(null); },
                // The successful mutation already invalidates every mounted list of this kind.
                success: () => undefined,
                error: (err) => { if (!retentionDisabled(api)) setNote(t(socialErrorKey(err))); },
            },
        );
    }

    if (status !== 'signedIn') return null;
    if (view.status === 'loading') return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
    if (view.status === 'closed') return <View style={styles.center}><Text style={styles.muted}>{t('cinema.retention.unavailable')}</Text></View>;
    if (view.status === 'error') {
        return (
            <Pressable accessibilityRole="button" style={styles.center} onPress={() => list.current?.reload()}>
                <Text style={styles.error}>{t(view.error ?? 'common.error')} {t('cinemaSocial.tapRetry')}</Text>
            </Pressable>
        );
    }
    const message = note ?? (view.error ? t(view.error) : null);
    if (view.items.length === 0) return <View style={styles.center}><Text style={styles.muted}>{t(`cinemaSocial.empty.${kind}`)}</Text>{message ? <Text style={styles.error} accessibilityRole="alert">{message}</Text> : null}</View>;
    return (
        <FlatList
            data={view.items}
            keyExtractor={(x) => x.targetId}
            contentContainerStyle={styles.list}
            onEndReached={() => { void list.current?.loadMore(); }}
            onEndReachedThreshold={0.6}
            ListHeaderComponent={message ? <Text style={styles.error} accessibilityRole="alert">{message}</Text> : undefined}
            renderItem={({ item }) => (
                <View style={styles.row}>
                    <Pressable accessibilityRole="button" style={styles.main} onPress={() => router.push({ pathname: '/cinema/[id]', params: { id: item.contentId } })}>
                        <Text style={styles.name} numberOfLines={2}>{kind === 'creator' ? item.creator : item.title}</Text>
                        {kind !== 'creator' && item.creator ? <Text style={styles.muted} numberOfLines={1}>{item.creator}</Text> : null}
                        {kind === 'creator' ? <Text style={styles.muted} numberOfLines={1}>{item.title}</Text> : null}
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={t(`cinemaSocial.remove.${kind}`, { name: kind === 'creator' ? item.creator : item.title })} style={styles.remove} disabled={removing} accessibilityState={{ disabled: removing }} onPress={() => remove(item)}>
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
