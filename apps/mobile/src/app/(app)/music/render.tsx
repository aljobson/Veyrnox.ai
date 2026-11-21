import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ScrollView } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../../auth/AuthProvider';
import { Text, themedStyles, useThemedStyles } from '../../../components/ui';
import { MusicRenderBody } from '../../../components/music/MusicRenderBody';
import { getCacheUser, subscribeCacheUser } from '../../../lib/appCache';
import { createRenderFlow } from '../../../lib/music/renderFlow';
import { t } from '../../../lib/i18n';
import { ds } from '../../../theme';

export default function Render() {
    const { id } = useLocalSearchParams<{ id: string }>(), { api } = useAuth();
    const user = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser);
    const [generation, setGeneration] = useState(0);
    const flow = useMemo(() => createRenderFlow(api, id), [api, id, user, generation]);
    const state = useSyncExternalStore(flow.subscribe, flow.snapshot, flow.snapshot), s = useThemedStyles(sheets);
    useEffect(() => {
        if (!flow.isLive()) { setGeneration(g => g + 1); return; }
        if (user) void flow.load();
        return flow.dispose;
    }, [flow, user]);
    return <ScrollView style={s.screen} contentContainerStyle={s.content}>
        <Stack.Screen options={{ title: t('musicRender.title') }} />
        <Text variant="title1" accessibilityRole="header">{t('musicRender.title')}</Text>
        <MusicRenderBody flow={flow} state={state} />
    </ScrollView>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, content: { padding: ds.space.lg, gap: ds.space.md } }));
