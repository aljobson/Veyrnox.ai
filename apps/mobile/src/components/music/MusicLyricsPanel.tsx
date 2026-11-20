import { useState } from 'react';
import { View } from 'react-native';
import { setStringAsync } from 'expo-clipboard';
import { Button, Text, TextField } from '../ui';
import { t } from '../../lib/i18n';
const LABELS = ['[Intro]', '[Verse]', '[Pre-Chorus]', '[Chorus]', '[Bridge]', '[Instrumental]', '[Outro]'] as const;
export function insertLyricsLabel(value: string, label: string, max: number, selection?: { start: number; end: number }) {
    const start = Math.max(0, Math.min(value.length, selection?.start ?? value.length));
    const end = Math.max(start, Math.min(value.length, selection?.end ?? value.length));
    const insert = `${start && value[start - 1] !== '\n' ? '\n' : ''}${label}\n`;
    const next = value.slice(0, start) + insert + value.slice(end);
    return next.length <= max ? { value: next, selection: { start: start + insert.length, end: start + insert.length } } : null;
}
export function MusicLyricsPanel({ value, max = 3000, onChange, instrumental = false }: {
    value: string; max?: number; onChange?: (value: string) => void; instrumental?: boolean;
}) {
    const [expanded, setExpanded] = useState(false);
    const [selection, setSelection] = useState<{ start: number; end: number }>();
    const [copyError, setCopyError] = useState(false);
    if (!onChange) {
        if (instrumental || !value) return null;
        return <View>
            <Button variant="secondary" label={t('music.create.submittedLyrics')} onPress={() => setExpanded(!expanded)} />
            {expanded ? <><Text selectable>{value}</Text>
                <Button label={t('music.create.copy')} onPress={() => { void setStringAsync(value).then(() => setCopyError(false), () => setCopyError(true)); }} />
                {copyError ? <Text>{t('music.create.error')}</Text> : null}</> : null}
        </View>;
    }
    return <View>
        <TextField label={t('music.create.lyrics')} multiline value={value} maxLength={max} onChangeText={onChange}
            selection={selection} onSelectionChange={event => setSelection(event.nativeEvent.selection)} />
        <Text>{t('music.create.counter', { count: value.length, max })}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {LABELS.map(label => <Button key={label} variant="secondary" label={label} onPress={() => {
                const next = insertLyricsLabel(value, label, max, selection);
                if (next) { onChange(next.value); setSelection(next.selection); }
            }} />)}
        </View>
    </View>;
}
