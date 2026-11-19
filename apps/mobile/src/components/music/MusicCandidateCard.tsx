import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Text } from '../ui';
import { VeyLoader } from '../VeyLoader';
import { t } from '../../lib/i18n';
import { MUSIC_ASSET_PATH } from '../../lib/music/validate';
import type { MusicCandidateView } from '../../lib/music/types';
import type { PlaybackInput } from '../../lib/music/player';
export function candidatePlayback(candidate: MusicCandidateView): PlaybackInput | null {
    const match = MUSIC_ASSET_PATH.exec(candidate.audio_url ?? '');
    return candidate.state === 'ready' && candidate.song_id && candidate.job_id && match?.[1] === candidate.job_id
        ? { songId: candidate.song_id, jobId: candidate.job_id, start: 0 } : null;
}
const validSongId = (id: string | null) => !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$(?![\s\S])/i.test(id);
export function MusicCandidateCard({ candidate, onPlay, openSongLabel, requireValidSongId = false }: { candidate: MusicCandidateView; onPlay: (input: PlaybackInput) => void; openSongLabel?: string; requireValidSongId?: boolean }) {
    const router = useRouter(), input = candidatePlayback(candidate);
    const terminal = ['ready', 'failed', 'refunded', 'cancelled'].includes(candidate.state);
    const state = terminal ? candidate.state : candidate.state === 'queued' ? 'queued' : 'running';
    return <Card>
        <Text variant="title3" accessibilityRole="header">{t('music.create.candidate', { label: candidate.label })}</Text>
        <Text>{t(`music.create.${state}`)}</Text>
        {!terminal ? <VeyLoader label={t('music.create.running')} /> : null}
        {candidate.state === 'ready' ? <View>
            {input ? <Button label={t('music.playNamed', { title: candidate.label })} onPress={() => onPlay(input)} />
                : <Text>{t('music.create.unplayable')}</Text>}
            {candidate.song_id && (!requireValidSongId || validSongId(candidate.song_id)) ? <Button variant="secondary" label={openSongLabel ?? t('music.create.openSong')} onPress={() => router.push({ pathname: '/music/[id]', params: { id: candidate.song_id! } })} /> : null}
        </View> : null}
    </Card>;
}
