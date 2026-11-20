import { View } from 'react-native';
import { Button, Chip, Text } from '../ui';
import { t } from '../../lib/i18n';
import { TTS_EMOTIONS, TTS_LANGUAGES, TTS_INPUT_RULES, type SpeechSettings } from '../../lib/speech/shared';
import { stepSpeechValue } from '../../lib/speech/studio';
import { SpeechLabel, speechLayout } from './SpeechFields';
const icons = { speed: 'gauge', volume: 'speaker', pitch: 'waveSine' } as const;
export function SpeechControls({ value, onChange }: { value: SpeechSettings; onChange: (settings: SpeechSettings) => void }) {
    return <View style={speechLayout.section}>
        <SpeechLabel icon="globe" label={t('speech.language')} />
        <View style={speechLayout.chips}>{TTS_LANGUAGES.map(language => <Chip key={language} label={language === 'auto' ? t('speech.auto') : language} selected={value.language === language} onPress={() => onChange({ ...value, language })} />)}</View>
        <SpeechLabel icon="smiley" label={t('speech.emotion')} />
        <View style={speechLayout.chips}>{TTS_EMOTIONS.map(emotion => <Chip key={emotion} label={t(`speech.emotion.${emotion}`)} selected={value.emotion === emotion} onPress={() => onChange({ ...value, emotion })} />)}</View>
        {(['speed', 'volume', 'pitch'] as const).map(key => {
            const rule = TTS_INPUT_RULES[`tts_${key}`];
            if (rule.type === 'enum') return null;
            const label = t(`speech.${key}`);
            return <View key={key} style={speechLayout.section}>
                <SpeechLabel icon={icons[key]} label={label} />
                <Text accessibilityLiveRegion="polite">{t('speech.value', { label, value: String(value[key]) })}</Text>
                <View style={speechLayout.chips}>{([-1, 1] as const).map(direction => <Button key={direction} variant="secondary"
                    label={t(direction < 0 ? 'speech.decrease' : 'speech.increase', { label })}
                    disabled={direction < 0 ? value[key] <= rule.min : value[key] >= rule.max}
                    onPress={() => onChange({ ...value, [key]: stepSpeechValue(key, value[key], direction) })} />)}</View>
            </View>;
        })}
    </View>;
}
