import { useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, Icon, ListRow } from '../ui';
import { t } from '../../lib/i18n';
import { MAX_AUDITION_VOICES, TTS_VOICES, voiceGenderOptions } from '../../lib/speech/shared';
import { SpeechLabel, speechLayout } from './SpeechFields';
export function VoicePicker({ value, onChange, board, onToggle, onTest }: {
    value: string; onChange: (id: string) => void; board: readonly string[];
    onToggle: (id: string) => void; onTest: (id: string) => void;
}) {
    const [gender, setGender] = useState('all');
    const [expanded, setExpanded] = useState(false);
    const voice = TTS_VOICES.find(item => item.id === value);
    return <View style={speechLayout.section}>
        <SpeechLabel icon="user" label={t('speech.voice')} />
        <Button variant="secondary" label={voice ? `${voice.label} · ${t(`speech.tone.${voice.tone}`)} · ${t(`speech.gender.${voice.gender}`)}` : t('speech.voice')}
            accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} />
        {expanded && <><View style={speechLayout.chips}>{['all', ...voiceGenderOptions()].map(item => <Chip key={item} label={t(`speech.gender.${item}`)} selected={gender === item} onPress={() => setGender(item)} />)}</View>
            {TTS_VOICES.filter(item => gender === 'all' || item.gender === gender).map(item => {
                const selected = board.includes(item.id), disabled = !selected && board.length >= MAX_AUDITION_VOICES;
                return <View key={item.id} style={speechLayout.section}><ListRow title={item.label}
                subtitle={`${t(`speech.tone.${item.tone}`)} · ${t(`speech.gender.${item.gender}`)}`} accessibilityLabel={`${item.label}, ${t(`speech.tone.${item.tone}`)}, ${t(`speech.gender.${item.gender}`)}`}
                accessibilityRole="radio" accessibilityState={{ checked: value === item.id }} trailing={value === item.id ? <Icon name="check" /> : <View />}
                onPress={() => { onChange(item.id); setExpanded(false); }} />
                <Button size="sm" variant="secondary" icon="listChecks"
                    label={t(selected ? 'speech.audition.remove' : 'speech.audition.add', { voice: item.label })}
                    disabled={disabled} accessibilityState={{ selected, disabled }} onPress={() => onToggle(item.id)} />
                <Button size="sm" variant="tertiary" icon="penNib" label={t('speech.audition.test')}
                    accessibilityLabel={t('speech.audition.testVoice', { voice: item.label })} accessibilityHint={t('speech.audition.testHint')}
                    onPress={() => { onTest(item.id); setExpanded(false); }} />
            </View>; })}</>}
    </View>;
}
