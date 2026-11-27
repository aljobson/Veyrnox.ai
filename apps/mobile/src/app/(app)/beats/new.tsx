import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { Button, Text, themedStyles, useThemedStyles } from '../../../components/ui';
import { t } from '../../../lib/i18n';
import { ds } from '../../../theme';
import { createSeedSession, seedErrorCode, type SeedCode } from '../../../lib/beatNative/songSeed';
import { nativeSeedDeps } from '../../../lib/beatNative/songSeedNative';
import { createMusicEdit } from '../../../lib/beatNative/templates';
import { beatStore, listBeats } from '../../../lib/beatNative/store';
export default function NewSongBeat() {
    const { song } = useLocalSearchParams<{ song?: string }>();
    const auth = useAuth(), router = useRouter(), s = useThemedStyles(sheets);
    const pending = useRef<ReturnType<typeof createSeedSession> | null>(null);
    const blankPending = useRef<Promise<string> | null>(null);
    const [error, setError] = useState<SeedCode | null>(null), [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let active = true;
        if (typeof song !== 'string' || !song) {
            const creating = blankPending.current ??= createMusicEdit(beatStore, t('beat.home.untitled', { n: listBeats().length + 1 })).then(doc => doc.id);
            void creating.then(id => {
                if (active) router.replace({ pathname: '/beats/[id]', params: { id, setup: '1' } } as never);
            }, () => { if (active) setError('r37'); });
            return () => { active = false; };
        }
        const session = pending.current ??= createSeedSession(nativeSeedDeps(auth, t('beatLabs.songTitle')), typeof song === 'string' ? song : '');
        session.acquire().then(id => { if (active) router.replace({ pathname: '/beats/[id]', params: { id } } as never); }, reason => {
            if (active) setError(seedErrorCode(reason));
        });
        return () => { active = false; session.release(); };
    // Each mount owns one seed; retry is the only action allowed to replace it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [attempt]);
    return <ScrollView style={s.screen} contentContainerStyle={s.content}>
        <Stack.Screen options={{ title: t('beatLabs.makeBeat') }} />
        <Text accessibilityLiveRegion="polite">{error ? t(`beatLabs.seed.error.${error}`) : t('beatLabs.loading')}</Text>
        {error ? <Button label={t('beat.retry')} onPress={() => { pending.current?.abort(); pending.current = null; blankPending.current = null; setError(null); setAttempt(n => n + 1); }} /> : null}
        <Button label={t('beatLabs.backLibrary')} onPress={() => { pending.current?.abort(); router.replace('/music' as never); }} />
    </ScrollView>;
}
const sheets = themedStyles(p => ({ screen: { flex: 1, backgroundColor: p.bg }, content: { padding: ds.space.gutter, gap: ds.space.lg } }));
