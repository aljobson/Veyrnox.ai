import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { View } from 'react-native';
import { Button, Text, useThemedStyles } from '../../../components/ui';
import { PublicShell, publicSheets } from '../../../components/music/PublicShell';
import { usePublicSession } from '../../../lib/music/usePublicMusic';
import { changeBlock, getBlocks } from '../../../lib/music/blocksClient';
import { t } from '../../../lib/i18n';
export default function BlockedCreators() {
    const { api, session, state } = usePublicSession();
    return <BlockedList key={state.account} api={api} session={session} state={state} />;
}
function BlockedList({ api, session, state }: ReturnType<typeof usePublicSession>) {
    const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
    const s = useThemedStyles(publicSheets);
    const load = useCallback(async () => { setLoading(true); setError(null);
        try { await getBlocks(api, session); } catch (e) { setError(e); } finally { setLoading(false); }
    }, [api, session]);
    useFocusEffect(useCallback(() => { void load(); }, [load]));
    return <PublicShell title={t('musicPublic.blockedCreators')} status={state.availability === 'off' ? 'off' : loading ? 'loading' : 'on'} refreshing={loading} error={error} refresh={() => void load()}>
        {!loading && !state.blocks.length ? <Text>{t('musicPublic.noBlocks')}</Text> : null}
        {state.blocks.map(b => <View key={b.actor_id} style={s.group}><Text>{b.display_name}</Text>
            <Button label={t('musicPublic.unblock')} disabled={busy} onPress={() => {
                setBusy(true); setError(null); void changeBlock(api, session, b.actor_id, false).catch(setError).finally(() => setBusy(false));
            }} />
        </View>)}
    </PublicShell>;
}
