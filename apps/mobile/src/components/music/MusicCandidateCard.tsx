import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Text } from '../ui';
import { VeyLoader } from '../VeyLoader';
import { plural, t } from '../../lib/i18n';
import { MUSIC_ASSET_PATH } from '../../lib/music/validate';
import type { MusicCandidateView } from '../../lib/music/types';
import type { PlaybackInput } from '../../lib/music/player';
import type { ApiClient } from '../../lib/api';
import { MusicCandidateCancel } from './MusicCandidateCancel';
import { useAnnouncement } from '../../lib/useAnnouncement';
export function candidatePlayback(candidate: MusicCandidateView): PlaybackInput | null {
    const match = MUSIC_ASSET_PATH.exec(candidate.audio_url ?? '');
    return candidate.state === 'ready' && candidate.song_id && candidate.job_id && match?.[1] === candidate.job_id
        ? { songId: candidate.song_id, jobId: candidate.job_id, start: 0 } : null;
}
const validSongId = (id: string | null) => !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$(?![\s\S])/i.test(id);
export function MusicCandidateCard({ candidate, onPlay, openSongLabel, requireValidSongId = false, cancellation, children }: { candidate: MusicCandidateView; onPlay: (input: PlaybackInput) => void; openSongLabel?: string; requireValidSongId?: boolean; cancellation?: { api: ApiClient; refresh: () => void | Promise<unknown>; afterCancel?: () => void | Promise<unknown> }; children?: ReactNode }) {
    const router = useRouter(), input = candidatePlayback(candidate);
    const terminal = ['ready', 'failed', 'refunded', 'cancelled'].includes(candidate.state);
    const userCancelled = candidate.error_code === 'user_cancelled';
    const state = userCancelled ? 'cancelled' : terminal ? candidate.state : candidate.state === 'queued' ? 'queued' : 'running';
    const cancelledMessage = userCancelled && candidate.credits !== undefined ? candidate.credits > 0
        ? plural('jobCancel.cancelled', candidate.credits) : t('jobCancel.cancelledFree') : null;
    useAnnouncement(cancelledMessage, { onMount: true, everywhere: true, eventKey: candidate.job_id ?? candidate.ordinal });
    return <Card>
        <Text variant="title3" accessibilityRole="header">{candidate.label === 'Track' ? t('music.create.track') : t('music.create.candidate', { label: candidate.label })}</Text>
        <Text>{state === 'refunded' && candidate.credits !== undefined
            ? t(candidate.credits > 0 ? 'music.create.refundedPaid' : 'music.create.refundedFree')
            : t(`music.create.${state}`)}</Text>
        {!terminal ? <VeyLoader label={t('music.create.running')} /> : null}
        {candidate.state === 'ready' ? <View>
            {input ? <Button label={t('music.playNamed', { title: candidate.label })} onPress={() => onPlay(input)} />
                : <Text>{t('music.create.unplayable')}</Text>}
            {candidate.song_id && (!requireValidSongId || validSongId(candidate.song_id)) ? <Button variant="secondary" label={openSongLabel ?? t('music.create.openSong')} onPress={() => router.push({ pathname: '/music/[id]', params: { id: candidate.song_id! } })} /> : null}
        </View> : null}
        {cancelledMessage ? <Text>{cancelledMessage}</Text> : null}
        {cancellation ? <MusicCandidateCancel candidate={candidate} api={cancellation.api}
            refresh={cancellation.refresh} afterCancel={cancellation.afterCancel} /> : null}
        {children}
    </Card>;
}
