import { View } from 'react-native';
import { Text } from '../ui';
import { CreateResult } from '../create/CreateResult';
import type { ApiClient } from '../../lib/api';
import type { CatalogModel } from '../../lib/media';
import { TTS_VOICES } from '../../lib/speech/shared';
import { t } from '../../lib/i18n';

export type AuditionJob = { id: string; voice: string };
export function AuditionResults({ api, jobs, modelId, catalog, onTerminal }: {
    api: ApiClient; jobs: readonly AuditionJob[]; modelId: string; catalog: CatalogModel[]; onTerminal: () => void;
}) {
    return <View style={{ width: '100%', gap: 20 }}>{jobs.map(job => <View key={job.id} testID={`speech-audition-result-${job.id}`} style={{ width: '100%', gap: 8 }}>
        <Text accessibilityRole="header">{t('speech.audition.result', { voice: TTS_VOICES.find(voice => voice.id === job.voice)?.label ?? job.voice })}</Text>
        <CreateResult api={api} batch={{ ids: [job.id], count: 1, modelId, kind: 'audio', aspect: null, duration: null }} catalog={catalog} onTerminal={onTerminal} />
    </View>)}</View>;
}
