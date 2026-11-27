import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Icon, Text, themedStyles, useThemedStyles } from '../ui';
import { addInstrumentTrack, filterInstruments, type Instrument } from '../../lib/beatNative/midi';
import type { Edit } from '../../lib/beatNative/doc';
import type { MenuIcon } from '../../lib/menuIcons';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';

const groupIcon = (group: string): MenuIcon => group === 'drums' ? 'drum'
    : group === 'guitar' ? 'guitar'
        : group === 'bass' ? 'guitar'
            : group === 'synth' ? 'keyboard'
                : group === 'wavetable' ? 'waveSine' : 'pianoKeys';

export function MusicInstrumentTray({ apply, disabled, refusal, onBack, onAdded }: {
    apply(op: Edit, label?: string): boolean;
    disabled: boolean;
    refusal?: string | null;
    onBack(): void;
    onAdded(): void;
}) {
    const groups = filterInstruments('');
    const [groupId, setGroupId] = useState(groups[0]?.id ?? 'drums');
    const [failed, setFailed] = useState(false);
    const selected = groups.find(group => group.id === groupId) ?? groups[0];
    const s = useThemedStyles(sheets);
    const add = (instrument: Instrument) => {
        setFailed(false);
        if (apply(doc => addInstrumentTrack(doc, instrument), t('beatPiano.library.add'))) onAdded();
        else setFailed(true);
    };
    return <View testID="music-instrument-tray" accessibilityLabel={t('beatPiano.library.title')} style={s.tray}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}
            testID="music-instrument-groups" accessibilityLabel={t('beatPiano.library.title')}>
            <Button testID="music-instrument-back" size="sm" variant="tertiary" icon="arrowLeft" iconOnly
                label={t('beat.back')} onPress={onBack} containerStyle={s.backHit} style={s.back} />
            {groups.map(group => <Button key={group.id} testID={`music-instrument-group-${group.id}`} size="sm"
                variant={group.id === selected?.id ? 'secondary' : 'tertiary'} label={t(`beatPiano.library.group.${group.id}`)}
                accessibilityRole="tab" accessibilityState={{ selected: group.id === selected?.id }}
                onPress={() => setGroupId(group.id)} containerStyle={s.groupHit} style={s.group}>
                <Icon name={groupIcon(group.id)} size={20} />
                <Text variant="footnote" numberOfLines={1}>{t(`beatPiano.library.group.${group.id}`)}</Text>
            </Button>)}
        </ScrollView>
        {selected ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}
            testID={`music-instrument-presets-${selected.id}`}>
            {selected.presets.map(preset => <Button key={preset.instrument.preset}
                testID={`music-instrument-add-${preset.instrument.id}-${preset.instrument.preset}`}
                size="sm" variant="tertiary" disabled={disabled}
                label={t('beatPiano.library.addNamed', { name: preset.label })}
                onPress={() => add(preset.instrument)} containerStyle={s.presetHit} style={s.preset}>
                <Icon name={groupIcon(selected.id)} size={24} />
                <Text variant="footnote" numberOfLines={1}>{preset.label}</Text>
            </Button>)}
        </ScrollView> : null}
        {failed ? <Text accessibilityLiveRegion="polite" tone="danger" variant="footnote" style={s.error}>
            {refusal || t('beat.refused', { reason: '' })}
        </Text> : null}
    </View>;
}

const sheets = themedStyles(p => ({
    tray: { width: '100%', maxWidth: 820, alignSelf: 'center', gap: ds.space.xs, borderTopWidth: 1,
        borderTopColor: p.borderSubtle, paddingTop: ds.space.xs },
    row: { alignItems: 'center', gap: ds.space.xs, paddingHorizontal: ds.space.xs },
    backHit: { width: 44, minHeight: 44 },
    back: { width: 44, minWidth: 44, paddingHorizontal: 0 },
    groupHit: { minWidth: 82 },
    group: { minWidth: 82, minHeight: 44, gap: 4, paddingHorizontal: ds.space.sm },
    presetHit: { minWidth: 112 },
    preset: { minWidth: 112, minHeight: 52, flexDirection: 'column', gap: 2, paddingHorizontal: ds.space.sm },
    error: { paddingHorizontal: ds.space.sm },
}));
