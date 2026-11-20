import type { ReactNode } from 'react';
import { Stack } from 'expo-router';
import { RefreshControl, ScrollView } from 'react-native';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';
import { MusicNotice } from './MusicNotice';
import { ds } from '../../theme';
import { t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { publicMessage } from '../../lib/music/publicMessages';
export function PublicShell({ title, status, refreshing, error, refresh, children }: {
    title: string; status: string; refreshing: boolean; error: unknown; refresh(): void; children?: ReactNode;
}) {
    const s = useThemedStyles(sheets);
    useAnnouncement(error ? publicMessage(error) : status === 'loading' ? t('music.loading') : status === 'on' ? t('musicPublic.loaded') : t('music.off'), { everywhere: true });
    return <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <Stack.Screen options={{ title }} />
        {status === 'loading' ? <Text accessibilityLiveRegion="polite">{t('music.loading')}</Text> : null}
        {status === 'off' || status === 'gone' ? <>
            <Text accessibilityLiveRegion="polite">{t(status === 'off' ? 'musicPublic.unavailable' : 'musicPublic.gone')}</Text>
            <Button label={t('music.refresh')} onPress={refresh} />
        </> : <>
            {error ? <MusicNotice message={publicMessage(error)} retry={refresh} /> : null}
            {children}
        </>}
    </ScrollView>;
}
export const publicSheets = themedStyles(() => ({ group: { gap: ds.space.sm } }));
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, content: { padding: ds.space.gutter, gap: ds.space.lg } }));
