import { useRouter } from 'expo-router';
import { Button, Text } from '../ui';
import { t } from '../../lib/i18n';
import type { createReplaceTake } from '../../lib/music/replaceTake';
import type { MusicCandidateView } from '../../lib/music/types';
export function MusicReplaceTakeControls({ keeper, state, candidate, songId }: {
    keeper: ReturnType<typeof createReplaceTake>; state: ReturnType<ReturnType<typeof createReplaceTake>['snapshot']>;
    candidate: MusicCandidateView; songId: string;
}) {
    if (candidate.state !== 'ready') return null;
    const selected = state.versionId === candidate.version_id;
    return <>
        <Button label={t(selected && state.phase === 'unknown' ? 'musicSectionActions.retryKeep' : 'musicSectionActions.keep', { label: candidate.label })}
            disabled={!keeper.canKeep(candidate)} onPress={() => void keeper.keep(candidate)} />
        {selected && state.phase === 'committing' ? <Text>{t('musicSectionActions.committing')}</Text> : null}
        {state.phase === 'committed' ? <Text>{t('musicSectionActions.committed', { label: state.label ?? '' })}</Text> : null}
        {state.phase === 'unknown' && selected ? <Text accessibilityRole="alert">{t('musicSectionActions.commitUnknown')}</Text> : null}
    </>;
}
// Pair-level notices render once per pair, not once per candidate.
export function MusicReplaceTakeNotices({ state, songId }: {
    state: ReturnType<ReturnType<typeof createReplaceTake>['snapshot']>; songId: string;
}) {
    const router = useRouter();
    return <>
        {state.phase === 'conflict' ? <Text accessibilityRole="alert">{t('musicSectionActions.commitConflict')}</Text> : null}
        {state.phase === 'error' ? <Text accessibilityRole="alert">{t('musicSectionActions.commitMissing')}</Text> : null}
        {state.phase === 'changed' ? <>
            <Text accessibilityRole="alert">{t('musicActions.action.changed')}</Text>
            <Button variant="secondary" label={t('musicGenerationActions.openSong')}
                onPress={() => router.push({ pathname: '/music/[id]', params: { id: songId } })} />
        </> : null}
    </>;
}
