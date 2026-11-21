import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Stack } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { Button, Card, Text, themedStyles, useThemedStyles } from '../ui';
import { MusicNotice } from './MusicNotice';
import { useAuth } from '../../auth/AuthProvider';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { createExportFlow } from '../../lib/music/exportFlow';
import { EXPORT_FORMATS } from '../../lib/music/validateExport';
import { exportMessage } from '../../lib/music/exportMessages';
import { t, plural } from '../../lib/i18n';
import { ds } from '../../theme';
export function MusicExportBody({ id }: { id: string }) {
    const { api } = useAuth(), s = useThemedStyles(sheets);
    const user = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser);
    const [generation, setGeneration] = useState(0);
    const flow = useMemo(() => createExportFlow(api, id), [api, id, user, generation]);
    const state = useSyncExternalStore(flow.subscribe, flow.snapshot, flow.snapshot);
    useEffect(() => {
        if (!flow.isLive()) { setGeneration(g => g + 1); return; }
        if (user) void flow.load();
        return flow.dispose;
    }, [flow, user]);
    const busy = ['loading', 'reviewing', 'confirming', 'saving'].includes(state.status);
    const ambiguous = state.pending?.phase === 'AMBIGUOUS';
    const quote = state.pending?.quote;
    return <ScrollView style={s.screen} contentContainerStyle={s.content}>
        <Stack.Screen options={{ title: t('musicExport.title') }} />
        <Text variant="title2" accessibilityRole="header">{t('musicExport.title')}</Text>
        {state.status === 'off' ? <MusicNotice message={t('musicExport.off')} /> : <>
            {busy ? <MusicNotice message={t(`musicExport.${state.status}`)} /> : null}
            {state.song ? <>
                {!state.result ? <>
                    <Text variant="callout">{t('musicExport.stored')}</Text>
                    <View accessibilityRole="radiogroup" accessibilityLabel={t('musicExport.choose')} style={s.choices}>
                        {EXPORT_FORMATS.map(format => <Button key={format} variant={state.format === format ? 'primary' : 'secondary'}
                            label={t(`musicExport.format.${format}`)} accessibilityRole="radio"
                            accessibilityState={{ selected: state.format === format, checked: state.format === format }}
                            disabled={busy || ambiguous} onPress={() => flow.edit(format)} />)}
                    </View>
                    <Text variant="footnote">{t('musicExport.freeReview')}</Text>
                    <Button label={t('musicExport.review')} disabled={busy || ambiguous} onPress={() => void flow.review()} />
                    {quote ? <Card>
                        <Text variant="title3" accessibilityRole="header">{t('musicExport.quoteFormat', { format: t(`musicExport.format.${quote.format}`) })}</Text>
                        <Text>{t(quote.consumes_allowance ? 'musicExport.consumes' : 'musicExport.claimed')}</Text>
                        <Text>{t('musicExport.usage', { used: quote.used, total: quote.allowance })}</Text>
                        <Text>{t('musicExport.after', { count: quote.remaining_after })}</Text>
                        {ambiguous ? <MusicNotice message={t('musicExport.ambiguous')} /> : null}
                        <Button label={t(ambiguous ? 'musicExport.recover' : 'musicExport.confirm')} disabled={busy} onPress={() => void flow.confirm()} />
                    </Card> : null}
                </> : <>
                    <MusicNotice message={t(state.sheetClosed ? 'musicExport.closed' : 'musicExport.ready')} />
                    <Button label={t('musicExport.save')} disabled={busy} onPress={() => void flow.save()} />
                    <Text>{plural('musicExport.remaining', state.result.allowance.remaining)}</Text>
                </>}
            </> : null}
            {state.error ? <MusicNotice message={exportMessage(state.error)} retry={!state.song ? () => void flow.load() : undefined} /> : null}
        </>}
    </ScrollView>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: ds.space.lg, gap: ds.space.md }, choices: { gap: ds.space.sm } }));
