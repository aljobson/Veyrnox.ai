import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { t } from '../../../lib/i18n';
import { fetchThread, inboxErrorKey, parseThreadView } from '../../../lib/publishInbox';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

export default function InboxThread() {
    const api = usePublishApi();
    const { id } = useLocalSearchParams<{ id?: string }>();
    const [view, setView] = useState<ReturnType<typeof parseThreadView> | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchThread(api, String(id ?? ''))
            .then((v) => !cancelled && setView(v))
            .catch((err) => !cancelled && setError(t(inboxErrorKey(err))));
        return () => {
            cancelled = true;
        };
    }, [api, id]);

    if (error) return <View style={styles.pad}><Stack.Screen options={{ title: t('inbox.title') }} /><Text style={styles.error} accessibilityRole="alert">{error}</Text></View>;
    if (!view) return <View style={styles.pad}><ActivityIndicator color={colors.accent} /></View>;
    const th = view.thread;

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
            <Stack.Screen options={{ title: th?.name || t('inbox.title') }} />
            {th ? <Text style={styles.muted}>{th.network} · {th.accountName} · {t(`inbox.kind.${th.kind}`)}{th.priority !== 'normal' ? ` · ${th.priority}` : ''}</Text> : null}
            {th?.tags.length ? <Text style={styles.tags}>{th.tags.join(', ')}</Text> : null}
            {view.messages.length === 0 ? <Text style={styles.muted}>{t('inbox.noMessages')}</Text> : null}
            {view.messages.map((m) => (
                <View key={m.id} style={[styles.bubble, m.outgoing ? styles.out : styles.in]} accessible accessibilityLabel={`${m.outgoing ? t('inbox.you') : th?.name ?? ''}: ${m.body}`}>
                    <Text style={styles.text}>{m.body || (m.hasMedia ? t('inbox.attachment') : '')}</Text>
                    {m.body && m.hasMedia ? <Text style={styles.muted}>{t('inbox.attachment')}</Text> : null}
                    <Text style={styles.meta}>{m.sentAt ? new Date(m.sentAt).toLocaleString() : ''}{m.deliveryStatus && m.outgoing ? ` · ${m.deliveryStatus}` : ''}</Text>
                </View>
            ))}
            {view.notes.length > 0 ? <Text style={styles.heading} accessibilityRole="header">{t('inbox.notes')}</Text> : null}
            {view.notes.map((n) => (
                <View key={n.id} style={styles.note}>
                    <Text style={styles.text}>{n.body}</Text>
                    <Text style={styles.meta}>{n.author}{n.createdAt ? ` · ${new Date(n.createdAt).toLocaleString()}` : ''}</Text>
                </View>
            ))}
            <Text style={styles.muted}>{t('inbox.replyOnWeb')}</Text>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    pad: { flex: 1, backgroundColor: colors.background, padding: 16 },
    body: { padding: 16, paddingBottom: VEY_CLEARANCE, gap: 8 },
    heading: { color: colors.muted, fontSize: 13, textTransform: 'uppercase', marginTop: 12 },
    bubble: { borderRadius: 12, padding: 12, gap: 4, maxWidth: '88%' },
    in: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, alignSelf: 'flex-start' },
    out: { backgroundColor: colors.surface, borderColor: colors.accent, borderWidth: 1, alignSelf: 'flex-end' },
    note: { backgroundColor: colors.surface, borderRadius: 12, padding: 12, gap: 4, borderColor: colors.border, borderWidth: 1 },
    text: { color: colors.text, fontSize: 15 },
    muted: { color: colors.muted, fontSize: 13 },
    meta: { color: colors.muted, fontSize: 12 },
    tags: { color: colors.accent, fontSize: 13 },
    error: { color: colors.danger },
});
