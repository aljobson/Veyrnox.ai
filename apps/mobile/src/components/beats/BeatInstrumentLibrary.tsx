import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { Button, Icon, Text, useThemedStyles } from '../ui';
import { BeatModal } from './BeatModal';
import { pianoStyles } from './pianoStyles';
import { addInstrumentTrack, filterInstruments, type Instrument } from '../../lib/beatNative/midi';
import type { Edit } from '../../lib/beatNative/doc';
import type { BeatAudio } from '../../lib/beatNative/audio';
import { t } from '../../lib/i18n';
import type { MenuIcon } from '../../lib/menuIcons';

const groupIcon = (group: string): MenuIcon => group === 'drums' ? 'waveform'
    : group === 'guitars' ? 'waveSine'
        : group === 'bass' ? 'speaker' : 'pianoKeys';

export function BeatInstrumentLibrary({ apply, audio, onClose, onDismiss, refusal }: { apply(op: Edit, label?: string): boolean; audio(): BeatAudio | null; onClose(): void; onDismiss?(): void; refusal?: string | null }) {
    const [query, setQuery] = useState(''), [notice, setNotice] = useState<{ message: string; announce: boolean } | null>(null);
    const [failed, setFailed] = useState(false);
    const s = useThemedStyles(pianoStyles);
    const audition = async (instrument: Instrument) => { try { await audio()?.audition(instrument); } catch { setNotice({ message: t('beat.audioError'), announce: true }); } };
    const groups = filterInstruments(query);
    return <BeatModal title={t('beatPiano.library.title')} onClose={onClose} onDismiss={onDismiss}>
        <Button label={t('beatPiano.library.close')} accessibilityLabel={t('beatPiano.library.close')}
            icon="close" iconOnly size="md" variant="tertiary" onPress={onClose} containerStyle={{ alignSelf: 'flex-end', marginTop: -56 }} />
        <TextInput style={s.field} value={query} onChangeText={setQuery} accessibilityLabel={t('beatPiano.library.search')} placeholder={t('beatPiano.library.search')} />
        {notice && <Text accessibilityLiveRegion={notice.announce ? 'polite' : 'none'}>{notice.message}</Text>}
        {failed && <Text accessibilityLiveRegion="none">{refusal || t('beat.refused', { reason: '' })}</Text>}
        {groups.map(group => <View key={group.id} style={s.section}>
            <View style={s.groupTitle}><Icon name={groupIcon(group.id)} size={18} /><Text accessibilityRole="header" variant="bodyStrong">{t(`beatPiano.library.group.${group.id}`)}</Text></View>
            <View style={s.presetGrid}>{group.presets.map(p => <View key={p.instrument.preset} style={s.presetTile}>
                <Button testID={`instrument-add-${p.instrument.id}-${p.instrument.preset}`}
                    label={t('beatPiano.library.addNamed', { name: p.label })} accessibilityLabel={t('beatPiano.library.addNamed', { name: p.label })}
                    variant="tertiary" size="sm" containerStyle={s.presetButtonHit} style={s.presetAdd} onPress={() => {
                    setNotice(null); setFailed(false);
                    if (apply(d => addInstrumentTrack(d, p.instrument), t('beatPiano.library.add'))) onClose();
                    else setFailed(true);
                    }}><View style={s.presetIcon}><Icon name={groupIcon(group.id)} size={22} /></View>
                    <Text variant="caption" numberOfLines={2} style={s.presetName}>{p.label}</Text>
                    <View style={s.addMark}><Icon name="plus" size={16} /></View>
                </Button>
                <Button label={t('beatPiano.library.audition', { name: p.label })} accessibilityLabel={t('beatPiano.library.audition', { name: p.label })}
                    icon="play" iconOnly size="sm" variant="tertiary" containerStyle={s.presetPreview} onPress={() => void audition(p.instrument)} />
            </View>)}</View>
        </View>)}
        {!groups.length && <Text>{t('beatPiano.library.empty')}</Text>}
    </BeatModal>;
}
