import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useRouter } from 'expo-router';
import { Button, Text } from '../ui';
import { MusicNotice } from './MusicNotice';
import { MusicPlayer } from './MusicPlayer';
import { MusicRenderForm } from './MusicRenderForm';
import { t } from '../../lib/i18n';
import { renderFormError } from '../../lib/music/renderForm';
import { renderMessage } from '../../lib/music/renderMessages';
import { renderAvailability, subscribeRenderAvailability } from '../../lib/music/renderAvailability';
import { canPlayRenderResult, type RenderFlow, type RenderState } from '../../lib/music/renderFlow';
import { songPlayback } from '../../lib/music/player';

export function MusicRenderBody({ flow, state }: { flow: RenderFlow; state: RenderState }) {
    const router = useRouter(), availability = useSyncExternalStore(subscribeRenderAvailability, renderAvailability, renderAvailability);
    const version = state.song?.version_id;
    const duration = useCallback((seconds: number) => { if (version) flow.setDuration(seconds, version); }, [flow, version]);
    const playback = useMemo(() => {
        try {
            if (!state.song) return null;
            // The render reads the full source asset, including for preview-only crops.
            const { songId, jobId } = songPlayback(state.song); return { songId, jobId, start: 0 };
        } catch { return null; }
    }, [state.song]);
    if (state.status === 'loading') return <Text>{t('music.loading')}</Text>;
    if (state.status === 'off') return <MusicNotice message={state.error ? renderMessage(state.error) : t('musicRender.editingOff')} />;
    if (state.status === 'error') return <MusicNotice message={state.error && ['not_found', 'song_id_invalid', 'not_authenticated'].includes(state.error)
        ? renderMessage(state.error) : t('music.loadError')} retry={() => void flow.load()} />;
    if (state.result) {
        const same = canPlayRenderResult(state);
        return <>
            <MusicNotice message={t('musicRender.saved', { number: state.result.version_number })} />
            {state.busy ? <Text>{t('music.loading')}</Text> : null}
            {state.refreshed && !same ? <Text>{t('musicRender.currentChanged')}</Text> : null}
            {state.error ? <MusicNotice message={renderMessage(state.error)} /> : null}
            {same && playback ? <MusicPlayer key={`result.${version}`} input={playback} /> : null}
            {!state.refreshed ? <Button label={t('musicRender.refresh')} disabled={state.busy} onPress={() => void flow.refresh()} /> : null}
            <Button label={t(same ? 'musicRender.back' : 'musicRender.openCurrent')}
                onPress={() => router.push({ pathname: '/music/[id]', params: { id: state.song!.id } } as never)} />
        </>;
    }
    const invalid = renderFormError(state.form, version ?? '', state.duration);
    const reverse = availability.reverse && !!state.song?.actions.includes('reverse');
    return <>
        <Text>{state.song?.title}</Text><Text>{t('musicRender.body')}</Text>
        {playback ? <MusicPlayer key={version} input={playback} onDuration={duration} /> : null}
        <Text>{state.duration === null ? t('musicRender.measure') : t('musicRender.measured', { seconds: state.duration })}</Text>
        <MusicRenderForm form={state.form} duration={state.duration} reverse={reverse} locked={state.busy || state.ambiguous} edit={flow.edit} />
        {invalid && invalid !== 'duration_required' ? <MusicNotice message={renderMessage(invalid)} /> : null}
        {state.ambiguous ? <MusicNotice message={t('musicRender.uncertain')} /> : null}
        {state.error ? <MusicNotice message={renderMessage(state.error)} /> : null}
        <Text>{t('musicRender.session')}</Text>
        <Button label={t(state.busy ? 'musicRender.saving' : state.ambiguous ? 'musicRender.retry' : 'musicRender.save')}
            disabled={state.busy || (!state.ambiguous && (!!invalid || (state.form.operation === 'reverse' && !reverse)))} onPress={() => void flow.confirm()} />
        {state.error && !state.ambiguous ? <Button label={t('musicRender.refresh')} disabled={state.busy} onPress={() => void flow.load()} /> : null}
    </>;
}
