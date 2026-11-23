import { View } from 'react-native';
import { Button, Chip, Text } from '../ui';
import { SpeechLabel, speechLayout } from '../speech/SpeechFields';
import { t } from '../../lib/i18n';
import { DIALOGUE_VOICES, type CastAssignment } from '../../lib/speech/dialogueShared';

export function CastMap({ assignments, disabled, onChange, onReset }: {
    assignments: readonly CastAssignment[]; disabled: boolean;
    onChange: (speaker: string, voice: string) => void; onReset: () => void;
}) {
    return <View style={speechLayout.section}>
        <SpeechLabel icon="microphone" label={t('dialogue.cast')} />
        {assignments.map(item => <View key={item.speaker.toLowerCase()} style={speechLayout.section}>
            <Text variant="bodyStrong">{item.speaker}</Text>
            <View style={speechLayout.chips}>{DIALOGUE_VOICES.map(voice => {
                const blocked = disabled;
                return <Chip key={voice} label={voice} accessibilityLabel={t('dialogue.chooseVoice', { speaker: item.speaker, voice })}
                    selected={item.voice === voice} disabled={blocked} accessibilityState={{ disabled: blocked }} onPress={() => onChange(item.speaker, voice)} />;
            })}</View>
        </View>)}
        <Button variant="secondary" label={t('dialogue.resetCast')} disabled={disabled} onPress={onReset} />
    </View>;
}
