import { View } from 'react-native';
import { Chip } from '../ui';
import { t } from '../../lib/i18n';
import { TTS_INTERJECTIONS, TTS_PAUSES, pauseCue } from '../../lib/speech/shared';
import { SpeechLabel, speechLayout } from './SpeechFields';
export function InsertBar({ onInsert }: { onInsert: (cue: string) => void }) {
    return <View style={speechLayout.section}>
        <SpeechLabel icon="pauseCircle" label={t('speech.pauses')} />
        <View style={speechLayout.chips}>{TTS_PAUSES.map(seconds => <Chip key={seconds} label={t('speech.pauseSeconds', { seconds: String(seconds) })} onPress={() => onInsert(pauseCue(seconds))} />)}</View>
        <SpeechLabel icon="chatText" label={t('speech.interjections')} />
        <View style={speechLayout.chips}>{TTS_INTERJECTIONS.map(([, cue]) => <Chip key={cue} label={t(`speech.cue.${cue.slice(1, -1)}`)} onPress={() => onInsert(cue)} />)}</View>
    </View>;
}
