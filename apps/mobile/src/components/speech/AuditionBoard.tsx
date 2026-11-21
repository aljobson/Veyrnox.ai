import { View } from 'react-native';
import { Button, Chip, Text } from '../ui';
import { t } from '../../lib/i18n';
import { MAX_AUDITION_VOICES, MIN_AUDITION_VOICES, TTS_VOICES } from '../../lib/speech/shared';
import { SpeechLabel, speechLayout } from './SpeechFields';

export function AuditionBoard({ voices, onRemove, onClear }: {
    voices: readonly string[]; onRemove: (voice: string) => void; onClear: () => void;
}) {
    return <View style={speechLayout.section}>
        <SpeechLabel icon="listChecks" label={t('speech.audition.title')} />
        <Text accessibilityLiveRegion="polite">{t('speech.audition.count', { count: voices.length, max: MAX_AUDITION_VOICES })}</Text>
        <View style={speechLayout.chips}>{voices.map(id => {
            const voice = TTS_VOICES.find(item => item.id === id)?.label ?? id;
            return <Chip key={id} label={voice} accessibilityLabel={t('speech.audition.remove', { voice })} onPress={() => onRemove(id)} />;
        })}</View>
        {voices.length === 0 ? <Text tone="secondary">{t('speech.audition.empty')}</Text> : <>
            {voices.length < MIN_AUDITION_VOICES && <Text>{t('speech.audition.addOne')}</Text>}
            <Button variant="tertiary" label={t('speech.audition.clear')} onPress={onClear} />
        </>}
    </View>;
}
