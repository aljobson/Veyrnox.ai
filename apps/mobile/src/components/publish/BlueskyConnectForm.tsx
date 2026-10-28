import { Text as StatusText } from '../ui/Text';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ApiClient } from '../../lib/api';
import { touchTarget } from '../../lib/a11y';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { t } from '../../lib/i18n';
import { BLUESKY_APP_PASSWORD_RE, BLUESKY_HANDLE_RE, connectBluesky } from '../../lib/publishConnect';
import { colors } from '../../theme';

export function BlueskyConnectForm({ api, onCancel }: { api: ApiClient; onCancel: () => void }) {
    const [handle, setHandle] = useState(''), [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [done, setDone] = useState(false);
    const generation = useRef(0), running = useRef(false);
    useEffect(() => {
        const clear = () => { generation.current++; running.current = false; setHandle(''); setPassword(''); setBusy(false); setError(null); setDone(false); };
        clear();
        const off = subscribeCacheUser(clear);
        return () => { generation.current++; off(); };
    }, [api]);
    async function submit() {
        if (running.current) return;
        if (!BLUESKY_HANDLE_RE.test(handle) || handle.length > 253) return setError('publishDepth.bluesky.badHandle');
        if (!BLUESKY_APP_PASSWORD_RE.test(password)) return setError('publishDepth.bluesky.format');
        const secret = password;
        setPassword(''); // Clear the controlled field before awaiting the one-time exchange.
        running.current = true; setBusy(true); setError(null);
        const token = generation.current, user = getCacheUser();
        const out = await connectBluesky(api, handle, secret);
        if (token !== generation.current || user !== getCacheUser()) return;
        if (out.kind === 'connected') setDone(true);
        else setError(out.kind === 'error' ? out.key : 'publishDepth.bluesky.failed');
        running.current = false; setBusy(false);
    }
    return <View style={styles.form} accessibilityState={{ busy }}>
        <Text accessibilityRole="header" style={styles.text}>Bluesky</Text>
        <Text style={styles.text}>{t('publishDepth.bluesky.handle')}</Text>
        <TextInput style={styles.input} accessibilityLabel={t('publishDepth.bluesky.handle')} value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false} maxLength={253} editable={!busy} />
        <Text style={styles.text}>{t('publishDepth.bluesky.password')}</Text>
        <TextInput style={styles.input} accessibilityLabel={t('publishDepth.bluesky.password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="off" textContentType="none" importantForAutofill="no" autoCapitalize="none" autoCorrect={false} maxLength={19} editable={!busy} />
        <Text style={styles.muted}>{t('publishDepth.bluesky.instructions')}</Text>
        {error ? <StatusText variant="inherit" accessibilityRole="alert" style={styles.error}>{t(error)}</StatusText> : null}
        {done ? <StatusText variant="inherit" accessibilityLiveRegion="polite" style={styles.text}>{t('connect.done', { name: 'Bluesky' })}</StatusText> : null}
        {busy ? <ActivityIndicator accessibilityLabel={t('connect.button')} accessibilityState={{ busy: true }} /> : null}
        <Pressable style={touchTarget} accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={submit}><Text style={styles.action}>{t('connect.button')}</Text></Pressable>
        <Pressable style={touchTarget} accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => { setPassword(''); onCancel(); }}><Text style={styles.action}>{t('publish.cancel')}</Text></Pressable>
    </View>;
}
const styles = StyleSheet.create({
    form: { gap: 8, paddingVertical: 12 }, text: { color: colors.text }, muted: { color: colors.muted }, error: { color: colors.danger }, action: { color: colors.accent },
    input: { minHeight: 44, padding: 12, color: colors.text, backgroundColor: colors.surface, borderRadius: 10 },
});
