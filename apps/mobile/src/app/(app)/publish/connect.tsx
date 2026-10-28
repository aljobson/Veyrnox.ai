import { Text as StatusText } from '../../../components/ui/Text';
import * as WebBrowser from 'expo-web-browser';
import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { touchTarget } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { BlueskyConnectForm } from '../../../components/publish/BlueskyConnectForm';
import { getCacheUser, subscribeCacheUser } from '../../../lib/appCache';
import { CONNECT_NETWORKS, fetchConnectNetworks, finishSelection, runConnect, type ConnectRow, type ConnectOutcome } from '../../../lib/publishConnect';
import { colors } from '../../../theme';

// The user's own brand is where the server adds a connected account, whichever brand is chosen in Publish.
export default function Connect() {
    const { api } = useAuth();
    const [busy, setBusy] = useState<string | null>(null);
    const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
    const running = useRef(false);

    const [networks, setNetworks] = useState<ConnectRow[] | null>(null);
    const [bluesky, setBluesky] = useState(false);
    const [chooser, setChooser] = useState<Extract<ConnectOutcome, { kind: 'choose' }> | null>(null);
    const generation = useRef(0);
    useEffect(() => {
        let alive = true;
        const load = () => {
            const token = ++generation.current, user = getCacheUser();
            setNetworks(null); setChooser(null); setBluesky(false); setNote(null); setBusy(null); running.current = false;
            fetchConnectNetworks(api).catch(() => null).then(rows => {
                if (alive && token === generation.current && user === getCacheUser()) setNetworks(rows ?? CONNECT_NETWORKS.map(n => ({ ...n, state: 'available' })));
            });
        };
        load(); const off = subscribeCacheUser(load);
        return () => { alive = false; generation.current++; off(); };
    }, [api]);
    function outcome(out: ConnectOutcome, label: string) {
        if (out.kind === 'choose') setChooser(out);
        else if (out.kind === 'connected') { setChooser(null); setNote({ text: t('connect.done', { name: out.account.displayName || label }), bad: false }); }
        else if (out.kind === 'cancelled') setNote({ text: t('connect.cancelled'), bad: false });
        else setNote({ text: t(out.key), bad: true });
    }
    async function choose(resourceId: string) {
        if (!chooser || running.current) return;
        const token = generation.current, user = getCacheUser();
        running.current = true; setBusy(chooser.network); setNote(null);
        const out = await finishSelection(api, chooser.network, chooser.selectionId, resourceId);
        if (token !== generation.current || user !== getCacheUser()) return;
        // The server spends the selection on the first POST, so a failed choice closes the chooser; connecting again starts a new one.
        if (out.kind !== 'choose' && out.kind !== 'connected') setChooser(null);
        outcome(out, chooser.network); running.current = false; setBusy(null);
    }
    async function connect(n: ConnectRow) {
        if (running.current || n.state !== 'available') return;
        if (n.key === 'bluesky') { setBluesky(true); setChooser(null); setNote(null); return; }
        const token = generation.current, user = getCacheUser();
        setBluesky(false); setChooser(null);
        running.current = true;
        setBusy(n.key);
        setNote(null);
        try {
            const out = await runConnect(api, n.key, {
                open: (url, returnUrl) => WebBrowser.openAuthSessionAsync(url, returnUrl),
                dev: __DEV__,
            });
            if (token === generation.current && user === getCacheUser()) outcome(out, n.label);
        } finally {
            if (token === generation.current && user === getCacheUser()) { running.current = false; setBusy(null); }
        }
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
            <Stack.Screen options={{ title: t('connect.title') }} />
            {!networks ? <ActivityIndicator accessibilityState={{ busy: true }} /> : null}
            <Text style={styles.intro}>{t('connect.intro')}</Text>
            {networks?.filter(n => n.key !== 'bluesky').map((n) => (
                <Pressable
                    key={n.key}
                    accessibilityRole="button"
                    accessibilityLabel={t('connect.action', { network: n.label })}
                    accessibilityState={{ busy: busy === n.key, disabled: busy !== null || n.state === 'setup' }}
                    disabled={busy !== null || n.state === 'setup'}
                    style={[touchTarget, styles.row, busy !== null && busy !== n.key && styles.off]}
                    onPress={() => connect(n)}
                >
                    <Text style={styles.name}>{n.label}</Text>
                    {busy === n.key ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.action}>{t(n.state === 'setup' ? 'connect.err.unavailable' : 'connect.button')}</Text>}
                </Pressable>
            ))}
            {networks?.filter(n => n.key === 'bluesky').map(n => <Pressable key={n.key} style={[touchTarget, styles.row]} accessibilityRole="button" accessibilityState={{ disabled: busy !== null || n.state === 'setup' }} disabled={busy !== null || n.state === 'setup'} onPress={() => connect(n)}>
                <Text style={styles.name}>{n.label}</Text><Text style={styles.action}>{t(n.state === 'setup' ? 'connect.err.unavailable' : 'connect.button')}</Text>
            </Pressable>)}
            {bluesky ? <BlueskyConnectForm api={api} onCancel={() => setBluesky(false)} /> : null}
            {chooser ? <View><Text accessibilityRole="header" style={styles.name}>{t('publishDepth.connect.choose')}</Text>
                {chooser.choices.map(c => <Pressable key={c.id} style={[touchTarget, styles.row]} accessibilityRole="button" accessibilityState={{ disabled: busy !== null, busy: busy !== null }} disabled={busy !== null} onPress={() => choose(c.id)}><Text style={styles.name}>{c.label}</Text></Pressable>)}
            </View> : null}
            {note ? <StatusText variant="inherit" style={[styles.note, note.bad && styles.bad]} accessibilityRole={note.bad ? 'alert' : undefined} accessibilityLiveRegion="polite">{note.text}</StatusText> : null}
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
