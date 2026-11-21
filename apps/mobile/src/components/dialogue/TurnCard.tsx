import { View } from 'react-native';
import { Button, Card, Text, TextField } from '../ui';
import { SpeechLabel } from '../speech/SpeechFields';
import { t } from '../../lib/i18n';
import type { DialogueTurn } from '../../lib/speech/dialogueShared';

export function TurnCard({ turn, index, count, voice, disabled, onChange, onMove, onRemove }: {
    turn: DialogueTurn; index: number; count: number; voice: string; disabled: boolean;
    onChange: (turn: DialogueTurn) => void; onMove: (direction: -1 | 1) => void; onRemove: () => void;
}) {
    const number = index + 1;
    return <Card style={{ gap: 12 }}>
        <SpeechLabel icon="user" label={t('dialogue.turn', { number })} />
        <TextField label={t('dialogue.speaker', { number })} value={turn.speaker} maxLength={30} editable={!disabled}
            onChangeText={speaker => onChange({ ...turn, speaker })} />
        <Text>{t('dialogue.turnVoice', { number, voice })}</Text>
        <TextField label={t('dialogue.words', { number })} value={turn.text} multiline editable={!disabled}
            style={{ minHeight: 96, textAlignVertical: 'top' }} onChangeText={text => onChange({ ...turn, text })} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button icon="arrowUp" iconOnly label={t('dialogue.moveUp', { number })} variant="secondary" size="md" disabled={disabled || index === 0} onPress={() => onMove(-1)} />
            <Button icon="arrowDown" iconOnly label={t('dialogue.moveDown', { number })} variant="secondary" size="md" disabled={disabled || index === count - 1} onPress={() => onMove(1)} />
            <Button icon="close" iconOnly label={t('dialogue.remove', { number })} variant="secondary" size="md" disabled={disabled || count <= 2} onPress={onRemove} />
        </View>
    </Card>;
}
