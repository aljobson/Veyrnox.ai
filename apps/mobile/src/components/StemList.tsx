import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../lib/a11y';
import type { ApiClient } from '../lib/api';
import { t } from '../lib/i18n';
import { mediaApi } from '../lib/media';
import { STEMS, shareOutput } from '../lib/output';
import { colors } from '../theme';

// The six tracks a stem-splitting job makes. Each link lasts 15 minutes and is fetched when a track is played or
// shared, never kept. Only labels the server listed (and the app knows) are shown.
export function StemList({ api, jobId, stems }: { readonly api: ApiClient; readonly jobId: string; readonly stems: readonly string[] }) {
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState(false);
    const shown = STEMS.filter((s) => stems.includes(s));

    async function act(stem: string, kind: 'play' | 'share') {
        if (busy) return;
        setBusy(stem);
        setError(false);
        try {
            const a = await mediaApi(api).getAsset(jobId, stem);
            if (kind === 'play') await WebBrowser.openBrowserAsync(a.url);
            else await shareOutput(a.url, jobId, a.mime_type, stem);
        } catch {
            setError(true);
        } finally {
            setBusy(null);
        }
    }

    return (
        <View style={styles.box}>
            <Text style={styles.title} accessibilityRole="header">{t('stems.title')}</Text>
            <Text style={styles.muted}>{t('stems.intro')}</Text>
            {shown.map((s) => (
                <View key={s} style={styles.row}>
                    <Text style={styles.name}>{t(`stem.${s}`)}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('stems.play', { stem: t(`stem.${s}`) })} disabled={!!busy} style={[styles.btn, touchTarget, !!busy && styles.off]} onPress={() => act(s, 'play')}>
                        <Text style={styles.btnText}>▶</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('stems.share', { stem: t(`stem.${s}`) })} disabled={!!busy} style={[styles.btn, touchTarget, !!busy && styles.off]} onPress={() => act(s, 'share')}>
                        <Text style={styles.btnText}>↗</Text>
                    </Pressable>
                </View>
            ))}
            {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{t('stems.error')}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    box: { gap: 8 },
    title: { color: colors.text, fontSize: 18, fontWeight: '700' },
    muted: { color: colors.muted },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
    name: { color: colors.text, fontSize: 16, flex: 1 },
    btn: { minWidth: 44, alignItems: 'center', borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    btnText: { color: colors.accent, fontSize: 18 },
    off: { opacity: 0.4 },
    error: { color: colors.danger },
});
