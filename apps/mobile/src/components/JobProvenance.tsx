import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../lib/a11y';
import { ApiError } from '../lib/api';
import { plural, t } from '../lib/i18n';
import { parseProvenance, sizeLabel, type Provenance } from '../lib/libraryView';
import { mediaApi } from '../lib/media';
import type { ApiClient } from '../lib/api';
import { colors } from '../theme';

// "How this was made": the server's own record of the job (GET /api/v1/jobs/:id/provenance). Read only when opened.
// It says what the record is and is not: with a digest the person can check a file they hold; without one it is a
// record of the generation only.
export function JobProvenance({ api, jobId }: { readonly api: ApiClient; readonly jobId: string }) {
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
        <View style={styles.box}>
            <Pressable accessibilityRole="button" accessibilityLabel={open ? t('prov.hide') : t('prov.show')} accessibilityState={{ expanded: open }} style={[styles.head, touchTarget]} onPress={toggle}>
                <Text style={styles.headLabel}>{t('prov.title')}</Text>
                <Text style={styles.muted}>{open ? '–' : '+'}</Text>
            </Pressable>
            {open ? (
                <View style={styles.body} accessibilityLiveRegion="polite">
                    {state === 'loading' ? <ActivityIndicator color={colors.accent} /> : null}
                    {state === 'error' ? <Text style={styles.error}>{t('prov.error')}</Text> : null}
                    {state === 'notReady' ? <Text style={styles.muted}>{t('prov.notReady')}</Text> : null}
                    {prov ? (
                        <>
                            <Text style={styles.line}>{t('prov.model', { model: prov.model })}</Text>
                            {prov.madeAt ? <Text style={styles.line}>{t('prov.when', { date: new Date(prov.madeAt).toLocaleString() })}</Text> : null}
                            {prov.credits !== null ? <Text style={styles.line}>{t('prov.cost', { credits: prov.credits > 0 ? plural('library.cost', prov.credits) : t('library.costFree') })}</Text> : null}
                            {prov.mime ? <Text style={styles.line}>{t('prov.file', { type: prov.mime, size: sizeLabel(prov.sizeBytes) ?? '—' })}</Text> : null}
                            {prov.sha256 ? (
                                <>
                                    <Text style={styles.muted}>{t('prov.hash')}</Text>
                                    <Text style={styles.hash} selectable>{prov.sha256}</Text>
                                    <Text style={styles.muted}>{t('prov.hashHelp')}</Text>
                                </>
                            ) : (
                                <Text style={styles.muted}>{t('prov.noHash')}</Text>
                            )}
                        </>
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    box: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14 },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    headLabel: { color: colors.text, fontWeight: '600' },
    body: { gap: 6, paddingBottom: 12 },
    line: { color: colors.body },
    muted: { color: colors.muted, fontSize: 13 },
    hash: { color: colors.text, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12 },
    error: { color: colors.danger },
});
