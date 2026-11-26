import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { Button, Icon, Text, useAppearance, useThemedStyles } from '../ui';
import { BeatModal } from './BeatModal';
import { pianoStyles } from './pianoStyles';
import { addInstrumentTrack, filterInstruments, type Instrument } from '../../lib/beatNative/midi';
import type { Edit } from '../../lib/beatNative/doc';
import type { BeatAudio } from '../../lib/beatNative/audio';
import { t } from '../../lib/i18n';
import type { MenuIcon } from '../../lib/menuIcons';
import { VIVID_HUES, vividHue } from '../../theme';

const groupIcon = (group: string): MenuIcon => group === 'drums' ? 'waveform'
    : group === 'guitars' ? 'waveSine'
        : group === 'bass' ? 'speaker' : 'pianoKeys';

export function BeatInstrumentLibrary({ apply, audio, onClose, onDismiss, refusal }: { apply(op: Edit, label?: string): boolean; audio(): BeatAudio | null; onClose(): void; onDismiss?(): void; refusal?: string | null }) {
    const [query, setQuery] = useState(''), [notice, setNotice] = useState<{ message: string; announce: boolean } | null>(null);
    const [failed, setFailed] = useState(false);
    const s = useThemedStyles(pianoStyles);
    const { scheme } = useAppearance();
    const audition = async (instrument: Instrument) => { try { await audio()?.audition(instrument); } catch { setNotice({ message: t('beat.audioError'), announce: true }); } };
    const groups = filterInstruments(query);
    return <BeatModal title={t('beatPiano.library.title')} onClose={onClose} onDismiss={onDismiss}>
        <Button label={t('beatPiano.library.close')} accessibilityLabel={t('beatPiano.library.close')}
            icon="close" iconOnly size="md" variant="tertiary" onPress={onClose} containerStyle={{ alignSelf: 'flex-end', marginTop: -56 }} />
        <TextInput style={s.field} value={query} onChangeText={setQuery} accessibilityLabel={t('beatPiano.library.search')} placeholder={t('beatPiano.library.search')} />
        {notice && <Text accessibilityLiveRegion={notice.announce ? 'polite' : 'none'}>{notice.message}</Text>}
        {failed && <Text accessibilityLiveRegion="none">{refusal || t('beat.refused', { reason: '' })}</Text>}
        {groups.map((group, groupIndex) => <View key={group.id} style={s.section}>
            <Text accessibilityRole="header">{t(`beatPiano.library.group.${group.id}`)}</Text>
            {group.presets.map((p, presetIndex) => {
                const tone = vividHue(VIVID_HUES[(groupIndex * 2 + presetIndex) % VIVID_HUES.length], scheme);
                return <View key={p.instrument.preset} style={[s.presetCard, { backgroundColor: tone.fill, borderColor: tone.edge }]}>
                    <View style={[s.presetIcon, { backgroundColor: tone.iconSurface }]}><Icon name={groupIcon(group.id)} size={24} tint={tone.foreground} /></View>
                    <Text variant="bodyStrong" numberOfLines={1} style={[s.presetName, { color: tone.foreground }]}>{p.label}</Text>
                    <View style={s.presetActions}>
                        <Button label={t('beatPiano.library.audition', { name: p.label })} accessibilityLabel={t('beatPiano.library.audition', { name: p.label })}
                            icon="play" iconOnly size="md" variant="tertiary" onPress={() => void audition(p.instrument)} />
                        <Button label={t('beatPiano.library.addNamed', { name: p.label })} accessibilityLabel={t('beatPiano.library.addNamed', { name: p.label })}
                            icon="plus" iconOnly size="md" variant="secondary" onPress={() => {
                        setNotice(null); setFailed(false);
                        if (apply(d => addInstrumentTrack(d, p.instrument), t('beatPiano.library.add'))) onClose();
                        else setFailed(true);
                        }} />
                    </View>
                </View>;
            })}
        </View>)}
        {!groups.length && <Text>{t('beatPiano.library.empty')}</Text>}
    </BeatModal>;
}
