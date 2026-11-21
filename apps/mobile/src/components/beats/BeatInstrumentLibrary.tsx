import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { Button, Text, useThemedStyles } from '../ui';
import { BeatModal } from './BeatModal';
import { pianoStyles } from './pianoStyles';
import { addInstrumentTrack, filterInstruments, type Instrument } from '../../lib/beatNative/midi';
import type { Edit } from '../../lib/beatNative/doc';
import type { BeatAudio } from '../../lib/beatNative/audio';
import { t } from '../../lib/i18n';

export function BeatInstrumentLibrary({ apply, audio, onClose }: { apply(op: Edit, label?: string): boolean; audio(): BeatAudio | null; onClose(): void }) {
    const [query, setQuery] = useState(''), [notice, setNotice] = useState<string | null>(null);
    const s = useThemedStyles(pianoStyles);
    const audition = async (instrument: Instrument) => { try { await audio()?.audition(instrument); } catch { setNotice(t('beat.audioError')); } };
    return <BeatModal title={t('beatPiano.library.title')} onClose={onClose}>
        <Button label={t('beatPiano.library.close')} onPress={onClose} />
        <TextInput style={s.field} value={query} onChangeText={setQuery} accessibilityLabel={t('beatPiano.library.search')} placeholder={t('beatPiano.library.search')} />
        {notice && <Text accessibilityLiveRegion="polite">{notice}</Text>}
        {filterInstruments(query).map(group => <View key={group.id} style={s.section}>
            <Text accessibilityRole="header">{t(`beatPiano.library.group.${group.id}`)}</Text>
            {group.presets.map(p => <View key={p.instrument.preset} style={s.section}>
                <Text>{p.label}</Text>
                <View style={s.row}>
                    <Button label={t('beatPiano.library.audition', { name: p.label })} onPress={() => void audition(p.instrument)} />
                    <Button label={t('beatPiano.library.addNamed', { name: p.label })} onPress={() => {
                        if (apply(d => addInstrumentTrack(d, p.instrument), t('beatPiano.library.add'))) onClose();
                        else onClose();
                    }} />
                </View>
            </View>)}
        </View>)}
        {!filterInstruments(query).length && <Text>{t('beatPiano.library.empty')}</Text>}
    </BeatModal>;
}
