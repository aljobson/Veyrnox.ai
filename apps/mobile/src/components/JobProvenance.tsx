import { Text, Button, Card, themedStyles, useThemedStyles } from './ui';
import { useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';

import { ApiError } from '../lib/api';
import { formatLocale, plural, t } from '../lib/i18n';
import { parseProvenance, sizeLabel, type Provenance } from '../lib/libraryView';
import { mediaApi } from '../lib/media';
import type { ApiClient } from '../lib/api';
import { ds } from '../theme';

// "How this was made": the server's own record of the job (GET /api/v1/jobs/:id/provenance). Read only when opened.
// It says what the record is and is not: with a digest the person can check a file they hold; without one it is a
// record of the generation only.
export function JobProvenance({ api, jobId }: { readonly api: ApiClient; readonly jobId: string }) {
    const styles = useThemedStyles(sheets);
    const [open, setOpen] = useState(false);
    const [state, setState] = useState<'idle' | 'loading' | 'error' | 'notReady'>('idle');
    const [prov, setProv] = useState<Provenance | null>(null);

    async function toggle() {
        const next = !open;
        setOpen(next);
        if (!next || prov || state === 'loading') return;
        setState('loading');
        try {
            const p = parseProvenance(await mediaApi(api).getProvenance(jobId));
            setProv(p);
            setState(p ? 'idle' : 'error');
        } catch (err) {
            setState(err instanceof ApiError && err.status === 409 ? 'notReady' : 'error');
        }
    }

    return (
        <Card style={styles.box}>
            <Button variant="tertiary" label={t('prov.title')} accessibilityRole="button" accessibilityLabel={open ? t('prov.hide') : t('prov.show')} accessibilityState={{ expanded: open }} icon={open ? 'caretDown' : 'caretRight'} onPress={toggle} />
            {open ? (
                <View style={styles.body} accessibilityLiveRegion="polite">
                    {state === 'loading' ? <ActivityIndicator color={styles.accentInk.color} /> : null}
                    {state === 'error' ? <Text variant="body" tone="danger" style={styles.error}>{t('prov.error')}</Text> : null}
                    {state === 'notReady' ? <Text variant="footnote" tone="tertiary" style={styles.muted}>{t('prov.notReady')}</Text> : null}
                    {prov ? (
                        <>
                            <Text variant="body" tone="secondary" style={styles.line}>{t('prov.model', { model: prov.model })}</Text>
                            {prov.madeAt ? <Text variant="body" tone="secondary" style={styles.line}>{t('prov.when', { date: new Date(prov.madeAt).toLocaleString(formatLocale()) })}</Text> : null}
                            {prov.credits !== null ? <Text variant="body" tone="warning">{t('prov.cost', { credits: prov.credits > 0 ? plural('library.cost', prov.credits) : t('library.costFree') })}</Text> : null}
                            {prov.mime ? <Text variant="body" tone="secondary" style={styles.line}>{t('prov.file', { type: prov.mime, size: sizeLabel(prov.sizeBytes) ?? '—' })}</Text> : null}
                            {prov.sha256 ? (
                                <>
                                    <Text variant="footnote" tone="tertiary" style={styles.muted}>{t('prov.hash')}</Text>
                                    <Text variant="body" tone="primary" style={styles.hash} selectable>{prov.sha256}</Text>
                                    <Text variant="footnote" tone="tertiary" style={styles.muted}>{t('prov.hashHelp')}</Text>
                                </>
                            ) : (
                                <Text variant="footnote" tone="tertiary" style={styles.muted}>{t('prov.noHash')}</Text>
                            )}
                        </>
                    ) : null}
                </View>
            ) : null}
        </Card>
    );
}

const sheets = themedStyles((p) => ({
    accentInk: { color: p.accent },

    box: { backgroundColor: p.bgElevated1, borderColor: p.borderSubtle, borderWidth: 1, borderRadius: ds.radius.md, paddingHorizontal: ds.space.md },
    body: { gap: ds.space.sm, paddingBottom: ds.space.md },
    line: { color: p.textSecondary },
    muted: { color: p.textTertiary, },
    hash: { color: p.textPrimary, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), },
    error: { color: p.danger },
}));
