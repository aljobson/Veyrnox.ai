import { rawText } from '../lib/i18n/translate';
import { Text, Button, Card, themedStyles, useThemedStyles } from './ui';
import { InlineMedia } from './InlineMedia';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { ApiClient } from '../lib/api';
import { t } from '../lib/i18n';
import { mediaApi } from '../lib/media';
import { STEMS, shareOutput } from '../lib/output';
import { ds } from '../theme';

// The six tracks a stem-splitting job makes. Each link lasts 15 minutes and is fetched when a track is played or
// shared, never kept. Only labels the server listed (and the app knows) are shown.
export function StemList({ api, jobId, stems, onReady }: { onReady?: () => void; readonly api: ApiClient; readonly jobId: string; readonly stems: readonly string[] }) {
    const styles = useThemedStyles(sheets);
    const [busy, setBusy] = useState<string | null>(null);
    const [playing, setPlaying] = useState<{ url: string; stem: string } | null>(null);
    const [error, setError] = useState(false);
    const shown = STEMS.filter((s) => stems.includes(s));

    async function act(stem: string, kind: 'play' | 'share') {
        if (busy) return;
        setBusy(stem);
        setError(false);
        try {
            const a = await mediaApi(api).getAsset(jobId, stem);
            if (kind === 'play') setPlaying({ url: a.url, stem });
            else await shareOutput(a.url, jobId, a.mime_type, stem);
        } catch {
            setError(true);
        } finally {
            setBusy(null);
        }
    }

    return (
        <View style={styles.box}>
            <Text variant="title3" tone="primary" style={styles.title} accessibilityRole="header">{t('stems.title')}</Text>
            <Text variant="body" tone="tertiary" style={styles.muted}>{t('stems.intro')}</Text>
            {shown.map((s) => (
                <Card key={s} style={styles.row}>
                    <Text variant="bodyStrong" tone="primary" style={styles.name}>{t(`stem.${s}`)}</Text>
                    <Button variant="secondary" accessibilityRole="button" accessibilityLabel={rawText(t('stems.play', { stem: t(`stem.${s}`) }))} disabled={!!busy} onPress={() => act(s, 'play')} label={t('stems.play', { stem: t(`stem.${s}`) })} icon="play" iconOnly />
                    <Button variant="secondary" accessibilityRole="button" accessibilityLabel={rawText(t('stems.share', { stem: t(`stem.${s}`) }))} disabled={!!busy} onPress={() => act(s, 'share')} label={t('stems.share', { stem: t(`stem.${s}`) })} icon="externalLink" iconOnly />
                </Card>
            ))}
            {playing && <InlineMedia onReady={onReady} key={playing.url} url={playing.url} audio label={t('stems.play', { stem: t(`stem.${playing.stem}`) })} />}
            {error ? <Text variant="body" tone="danger" style={styles.error} accessibilityLiveRegion="polite">{t('stems.error')}</Text> : null}
        </View>
    );
}

const sheets = themedStyles((p) => ({

    box: { gap: ds.space.sm },
    title: { color: p.textPrimary, },
    muted: { color: p.textTertiary },
    row: { flexDirection: 'row', alignItems: 'center', gap: ds.space.sm, borderBottomColor: p.borderSubtle, borderBottomWidth: StyleSheet.hairlineWidth },
    name: { color: p.textPrimary, flex: 1 },
    error: { color: p.danger },
}));
