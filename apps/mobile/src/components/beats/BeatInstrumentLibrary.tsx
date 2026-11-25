import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Button, Icon, Text, themedStyles, usePressStyle, useThemedStyles } from '../ui';
import { BeatModal } from './BeatModal';
import { addInstrumentTrack, filterInstruments, INSTRUMENT_GROUPS, type Instrument } from '../../lib/beatNative/midi';
import type { Edit } from '../../lib/beatNative/doc';
import type { BeatAudio } from '../../lib/beatNative/audio';
import { t } from '../../lib/i18n';
import type { MenuIcon } from '../../lib/menuIcons';
import { ds } from '../../theme';

const groupIcon = (group: string): MenuIcon => group === 'drums' ? 'waveform'
    : group === 'guitar' ? 'waveSine'
        : group === 'bass' ? 'speaker'
            : group === 'synth' ? 'sliders'
                : group === 'wavetable' ? 'faders' : 'pianoKeys';

const instrumentKey = (instrument: Instrument) => `${instrument.engine}:${instrument.id}:${instrument.preset}`;

export function BeatInstrumentLibrary({ apply, audio, onClose, onDismiss, refusal }: { apply(op: Edit, label?: string): boolean; audio(): BeatAudio | null; onClose(): void; onDismiss?(): void; refusal?: string | null }) {
    const [query, setQuery] = useState('');
    const [activeGroup, setActiveGroup] = useState(INSTRUMENT_GROUPS[0]?.id ?? 'piano');
    const [selectedKey, setSelectedKey] = useState(() => instrumentKey(INSTRUMENT_GROUPS[0]?.presets[0]?.instrument ?? { engine: 'voice', id: 'piano', preset: 'grand' }));
    const [notice, setNotice] = useState<{ message: string; announce: boolean } | null>(null);
    const [failed, setFailed] = useState(false);
    const s = useThemedStyles(styles);
    const pressStyle = usePressStyle();
    const audition = async (instrument: Instrument) => { try { await audio()?.audition(instrument); } catch { setNotice({ message: t('beat.audioError'), announce: true }); } };
    const searched = query.trim().length > 0;
    const groups = filterInstruments(query).filter(group => searched || group.id === activeGroup);
    const choices = groups.flatMap(group => group.presets.map(preset => ({ ...preset, groupId: group.id })));
    const selected = choices.find(choice => instrumentKey(choice.instrument) === selectedKey) ?? choices[0];
    return <BeatModal title={t('beatPiano.library.title')} onClose={onClose} onDismiss={onDismiss}>
        <Button label={t('beatPiano.library.close')} accessibilityLabel={t('beatPiano.library.close')}
            icon="close" iconOnly size="md" variant="tertiary" onPress={onClose} containerStyle={s.close} />
        <View style={s.searchShell}>
            <Icon name="search" size={20} />
            <TextInput style={s.field} value={query} onChangeText={setQuery} accessibilityLabel={t('beatPiano.library.search')} placeholder={t('beatPiano.library.search')} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.categories} accessibilityRole="tablist">
            {INSTRUMENT_GROUPS.map(group => {
                const active = !searched && group.id === activeGroup;
                return <Pressable key={group.id}
                testID={`instrument-category-${group.id}`}
                accessibilityRole="tab"
                accessibilityLabel={t(`beatPiano.library.group.${group.id}`)}
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [s.category, active && s.categoryActive, pressed && pressStyle]}
                onPress={() => {
                    setActiveGroup(group.id);
                    setSelectedKey(instrumentKey(group.presets[0].instrument));
                    setQuery('');
                }}>
                    <Icon name={groupIcon(group.id)} size={24} />
                    <Text variant="micro" tone={active ? 'primary' : 'secondary'} numberOfLines={1}>{t(`beatPiano.library.group.${group.id}`)}</Text>
                </Pressable>;
            })}
        </ScrollView>
        {notice && <Text accessibilityLiveRegion={notice.announce ? 'polite' : 'none'}>{notice.message}</Text>}
        {failed && <Text accessibilityLiveRegion="none">{refusal || t('beat.refused', { reason: '' })}</Text>}
        {groups.map(group => <View key={group.id} style={s.section}>
            {searched ? <Text accessibilityRole="header" variant="bodyStrong">{t(`beatPiano.library.group.${group.id}`)}</Text> : null}
            <View testID={`instrument-grid-${group.id}`} style={s.grid}>
                {group.presets.map(p => {
                    const active = instrumentKey(p.instrument) === instrumentKey(selected?.instrument ?? p.instrument);
                    return <Pressable key={p.instrument.preset} testID={`instrument-tile-${p.instrument.preset}`}
                        accessibilityRole="radio"
                        accessibilityLabel={p.label}
                        accessibilityState={{ checked: active }}
                        style={({ pressed }) => [s.tile, active && s.tileActive, pressed && pressStyle]}
                        onPress={() => setSelectedKey(instrumentKey(p.instrument))}>
                        <View style={s.tileIcon}><Icon name={groupIcon(group.id)} size={24} /></View>
                        <Text variant="bodyStrong" numberOfLines={2} style={s.presetName}>{p.label}</Text>
                        {active ? <View style={s.selectedMark}><Icon name="check" size={16} /></View> : null}
                    </Pressable>;
                })}
            </View>
        </View>)}
        {!groups.length && <Text>{t('beatPiano.library.empty')}</Text>}
        {selected ? <View style={s.actionDock} accessibilityLabel={selected.label}>
            <Pressable accessibilityRole="button"
                accessibilityLabel={t('beatPiano.library.audition', { name: selected.label })}
                style={({ pressed }) => [s.action, pressed && pressStyle]}
                onPress={() => void audition(selected.instrument)}>
                <Icon name="play" size={28} />
                <Text variant="caption" tone="secondary">{t('beatPiano.library.preview')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button"
                accessibilityLabel={t('beatPiano.library.addNamed', { name: selected.label })}
                testID="instrument-add-selected"
                style={({ pressed }) => [s.action, pressed && pressStyle]}
                onPress={() => {
                    setNotice(null); setFailed(false);
                    if (apply(d => addInstrumentTrack(d, selected.instrument), t('beatPiano.library.add'))) onClose();
                    else setFailed(true);
                }}>
                <Icon name="plus" size={28} />
                <Text variant="caption" tone="secondary">{t('beatPiano.library.add')}</Text>
            </Pressable>
        </View> : null}
    </BeatModal>;
}

const styles = themedStyles(p => ({
    close: { alignSelf: 'flex-end', marginTop: -56 },
    searchShell: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: ds.space.sm, borderRadius: ds.radius.pill, backgroundColor: p.surface, paddingHorizontal: ds.space.md },
    field: { flex: 1, minHeight: 48, minWidth: 100, color: p.textPrimary, paddingVertical: ds.space.sm },
    categories: { gap: ds.space.xs, alignItems: 'flex-start', paddingEnd: ds.space.gutter },
    category: { width: 76, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: ds.space.xs, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    categoryActive: { borderBottomColor: p.accent },
    section: { gap: ds.space.sm },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
    tile: { width: '48%', minHeight: 108, padding: ds.space.md, justifyContent: 'space-between', gap: ds.space.sm, borderWidth: 1, borderColor: p.borderSubtle, borderRadius: ds.radius.lg, backgroundColor: p.bgElevated1 },
    tileActive: { borderWidth: 2, borderColor: p.accent, backgroundColor: p.accentSubtle },
    tileIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: ds.radius.md, backgroundColor: p.accentSubtle },
    presetName: { minWidth: 0 },
    selectedMark: { position: 'absolute', end: ds.space.sm, top: ds.space.sm },
    actionDock: { minHeight: 84, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: ds.space.hero, borderTopWidth: 1, borderTopColor: p.borderSubtle, paddingTop: ds.space.sm },
    action: { minWidth: 72, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: ds.space.xs },
}));
