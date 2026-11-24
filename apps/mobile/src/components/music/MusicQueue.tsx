import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '../ui';
import { t } from '../../lib/i18n';
import type { TrackedGeneration } from '../../lib/music/queue';
import type { PlaybackInput } from '../../lib/music/player';
import { MusicCandidateCard } from './MusicCandidateCard';
import { MusicLyricsPanel } from './MusicLyricsPanel';
import { MusicPlayer } from './MusicPlayer';
import type { ApiClient } from '../../lib/api';
export function MusicQueue({ entries, activeCount, limit, api, refresh, afterCancel }: { entries: readonly TrackedGeneration[]; activeCount: number; limit: number; api?: ApiClient; refresh?: (id: string) => void; afterCancel?: () => void | Promise<unknown> }) {
    const [selected, setSelected] = useState<PlaybackInput | null>(null);
    const current = selected && entries.some(e => e.view.candidates.some(c => c.song_id === selected.songId && c.job_id === selected.jobId));
    return <View style={{ gap: 16 }}>
        <Text variant="title3">{t('music.create.queue', { count: activeCount, limit })}</Text>
        {current && selected ? <MusicPlayer key={`${selected.songId}:${selected.jobId}`} input={selected} /> : null}
        {entries.map(entry => <View key={entry.id} style={{ gap: 12 }}>
            <Text variant="bodyStrong">{entry.input.title || t('music.create.untitled')}</Text>
            {entry.missing ? <Text>{t('music.create.missing')}</Text>
                : entry.view.candidates.map(candidate => <MusicCandidateCard key={candidate.ordinal} candidate={candidate} onPlay={setSelected}
                    cancellation={api && refresh ? { api, refresh: () => refresh(entry.id), afterCancel } : undefined}
                    requireValidSongId={!!entry.sourceAction} openSongLabel={entry.sourceAction ? t('musicGenerationActions.openSong') : undefined} />)}
            {!entry.sourceAction ? <MusicLyricsPanel value={entry.input.lyrics} instrumental={entry.input.instrumental} /> : null}
        </View>)}
    </View>;
}
