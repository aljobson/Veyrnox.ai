import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { Button, Text, useThemedStyles } from '../ui';
import { BeatModal } from './BeatModal';
import { pianoStyles } from './pianoStyles';
import { addInstrumentTrack, filterInstruments, type Instrument } from '../../lib/beatNative/midi';
import type { Edit } from '../../lib/beatNative/doc';
import type { BeatAudio } from '../../lib/beatNative/audio';
import { t } from '../../lib/i18n';

export function BeatInstrumentLibrary({ apply, audio, onClose, onDismiss, refusal }: { apply(op: Edit, label?: string): boolean; audio(): BeatAudio | null; onClose(): void; onDismiss?(): void; refusal?: string | null }) {
    const [query, setQuery] = useState(''), [notice, setNotice] = useState<{ message: string; announce: boolean } | null>(null);
    const [failed, setFailed] = useState(false);
    const s = useThemedStyles(pianoStyles);
    const audition = async (instrument: Instrument) => { try { await audio()?.audition(instrument); } catch { setNotice({ message: t('beat.audioError'), announce: true }); } };
    const groups = filterInstruments(query);
    return <BeatModal title={t('beatPiano.library.title')} onClose={onClose} onDismiss={onDismiss}>
        <Button label={t('beatPiano.library.close')} onPress={onClose} />
        <TextInput style={s.field} value={query} onChangeText={setQuery} accessibilityLabel={t('beatPiano.library.search')} placeholder={t('beatPiano.library.search')} />
        {notice && <Text accessibilityLiveRegion={notice.announce ? 'polite' : 'none'}>{notice.message}</Text>}
        {failed && <Text accessibilityLiveRegion="none">{refusal || t('beat.refused', { reason: '' })}</Text>}
        {groups.map(group => <View key={group.id} style={s.section}>
            <Text accessibilityRole="header">{t(`beatPiano.library.group.${group.id}`)}</Text>
            {group.presets.map(p => <View key={p.instrument.preset} style={s.section}>
                <Text>{p.label}</Text>
                <View style={s.row}>
                    <Button label={t('beatPiano.library.audition', { name: p.label })} onPress={() => void audition(p.instrument)} />
                    <Button label={t('beatPiano.library.addNamed', { name: p.label })} onPress={() => {
                        setNotice(null); setFailed(false);
                        if (apply(d => addInstrumentTrack(d, p.instrument), t('beatPiano.library.add'))) onClose();
                        else setFailed(true);
                    }} />
                </View>
            </View>)}
        </View>)}
        {!groups.length && <Text>{t('beatPiano.library.empty')}</Text>}
    </BeatModal>;
}
