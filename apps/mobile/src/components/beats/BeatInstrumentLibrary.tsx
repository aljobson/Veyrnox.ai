import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { Button, Icon, Text, useThemedStyles } from '../ui';
import { BeatModal } from './BeatModal';
import { pianoStyles } from './pianoStyles';
import { addInstrumentTrack, filterInstruments } from '../../lib/beatNative/midi';
import type { Edit } from '../../lib/beatNative/doc';
import { t } from '../../lib/i18n';
import type { MenuIcon } from '../../lib/menuIcons';

const groupIcon = (group: string): MenuIcon => group === 'drums' ? 'drum'
    : group === 'guitar' ? 'guitar'
        : group === 'bass' ? 'guitar'
            : group === 'synth' ? 'keyboard'
                : group === 'wavetable' ? 'waveSine' : 'pianoKeys';

export function BeatInstrumentLibrary({ apply, onClose, onDismiss, refusal }: { apply(op: Edit, label?: string): boolean; onClose(): void; onDismiss?(): void; refusal?: string | null }) {
    const [query, setQuery] = useState('');
    const [failed, setFailed] = useState(false);
    const s = useThemedStyles(pianoStyles);
    const groups = filterInstruments(query);
    return <BeatModal title={t('beatPiano.library.title')} onClose={onClose} onDismiss={onDismiss}>
        <Button label={t('beatPiano.library.close')} accessibilityLabel={t('beatPiano.library.close')}
            icon="close" iconOnly size="md" variant="tertiary" onPress={onClose} containerStyle={{ alignSelf: 'flex-end', marginTop: -56 }} />
        <TextInput style={s.field} value={query} onChangeText={setQuery} accessibilityLabel={t('beatPiano.library.search')} placeholder={t('beatPiano.library.search')} />
        {failed && <Text accessibilityLiveRegion="none">{refusal || t('beat.refused', { reason: '' })}</Text>}
        {groups.map(group => <View key={group.id} style={s.section}>
            <View style={s.groupTitle}><Icon name={groupIcon(group.id)} size={20} /><Text accessibilityRole="header" variant="bodyStrong">{t(`beatPiano.library.group.${group.id}`)}</Text></View>
            <View style={s.presetGrid}>{group.presets.map(p => <View key={p.instrument.preset} style={s.presetTile}>
                <Button testID={`instrument-add-${p.instrument.id}-${p.instrument.preset}`}
                    label={t('beatPiano.library.addNamed', { name: p.label })} accessibilityLabel={t('beatPiano.library.addNamed', { name: p.label })}
                    variant="tertiary" size="sm" containerStyle={s.presetButtonHit} style={s.presetAdd} onPress={() => {
                    setFailed(false);
                    if (apply(d => addInstrumentTrack(d, p.instrument), t('beatPiano.library.add'))) onClose();
                    else setFailed(true);
                    }}><View style={s.presetIcon}><Icon name={groupIcon(group.id)} size={24} /></View>
                    <Text variant="caption" numberOfLines={2} style={s.presetName}>{p.label}</Text>
                </Button>
            </View>)}</View>
        </View>)}
        {!groups.length && <Text>{t('beatPiano.library.empty')}</Text>}
    </BeatModal>;
}
