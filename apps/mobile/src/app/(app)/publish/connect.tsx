import * as WebBrowser from 'expo-web-browser';
import { Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { touchTarget } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { CONNECT_NETWORKS, runConnect, type ConnectNetwork } from '../../../lib/publishConnect';
import { colors } from '../../../theme';

// The user's own brand is where the server adds a connected account, whichever brand is chosen in Publish.
export default function Connect() {
    const { api } = useAuth();
    const [busy, setBusy] = useState<string | null>(null);
    const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
    const running = useRef(false);

    async function connect(n: ConnectNetwork) {
        if (running.current) return;
        running.current = true;
        setBusy(n.key);
        setNote(null);
        try {
            const out = await runConnect(api, n.key, {
                open: (url, returnUrl) => WebBrowser.openAuthSessionAsync(url, returnUrl),
                dev: __DEV__,
            });
            if (out.kind === 'connected') setNote({ text: t('connect.done', { name: out.account.displayName || n.label }), bad: false });
            else if (out.kind === 'cancelled') setNote({ text: t('connect.cancelled'), bad: false });
            else setNote({ text: t(out.key), bad: true });
        } finally {
            running.current = false;
            setBusy(null);
        }
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
            <Stack.Screen options={{ title: t('connect.title') }} />
            <Text style={styles.intro}>{t('connect.intro')}</Text>
            {CONNECT_NETWORKS.map((n) => (
                <Pressable
                    key={n.key}
                    accessibilityRole="button"
                    accessibilityLabel={t('connect.action', { network: n.label })}
                    accessibilityState={{ busy: busy === n.key, disabled: busy !== null }}
                    disabled={busy !== null}
                    style={[touchTarget, styles.row, busy !== null && busy !== n.key && styles.off]}
                    onPress={() => connect(n)}
                >
                    <Text style={styles.name}>{n.label}</Text>
                    {busy === n.key ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.action}>{t('connect.button')}</Text>}
                </Pressable>
            ))}
            {note ? <Text style={[styles.note, note.bad && styles.bad]} accessibilityRole={note.bad ? 'alert' : undefined} accessibilityLiveRegion="polite">{note.text}</Text> : null}
            <View style={styles.footer}>
                <Text style={styles.muted}>{t('connect.own')}</Text>
                <Text style={styles.muted}>{t('connect.remove')}</Text>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 10 },
    intro: { color: colors.body },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14 },
    off: { opacity: 0.4 },
    name: { color: colors.text, fontSize: 17, flexShrink: 1 },
    action: { color: colors.accent, fontWeight: '600' },
    note: { color: colors.accent, marginTop: 6 },
    bad: { color: colors.danger },
    footer: { gap: 6, marginTop: 12 },
    muted: { color: colors.muted, fontSize: 13 },
});
