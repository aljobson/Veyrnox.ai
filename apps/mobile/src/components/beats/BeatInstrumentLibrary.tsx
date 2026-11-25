import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Button, Icon, Text, useAppearance, useThemedStyles } from '../ui';
import { BeatModal } from './BeatModal';
import { pianoStyles } from './pianoStyles';
import { addInstrumentTrack, filterInstruments, type Instrument } from '../../lib/beatNative/midi';
import type { Edit } from '../../lib/beatNative/doc';
import type { BeatAudio } from '../../lib/beatNative/audio';
import { t } from '../../lib/i18n';
import { ds, VIVID_HUES, vividHue } from '../../theme';

export function BeatInstrumentLibrary({ apply, audio, onClose, onDismiss, refusal }: { apply(op: Edit, label?: string): boolean; audio(): BeatAudio | null; onClose(): void; onDismiss?(): void; refusal?: string | null }) {
    const [query, setQuery] = useState(''), [notice, setNotice] = useState<{ message: string; announce: boolean } | null>(null);
    const [failed, setFailed] = useState(false);
    const s = useThemedStyles(pianoStyles);
    const { scheme } = useAppearance();
    const audition = async (instrument: Instrument) => { try { await audio()?.audition(instrument); } catch { setNotice({ message: t('beat.audioError'), announce: true }); } };
    const groups = filterInstruments(query);
    return <BeatModal title={t('beatPiano.library.title')} onClose={onClose} onDismiss={onDismiss}>
        <Button label={t('beatPiano.library.close')} onPress={onClose} />
        <TextInput style={s.field} value={query} onChangeText={setQuery} accessibilityLabel={t('beatPiano.library.search')} placeholder={t('beatPiano.library.search')} />
        {notice && <Text accessibilityLiveRegion={notice.announce ? 'polite' : 'none'}>{notice.message}</Text>}
        {failed && <Text accessibilityLiveRegion="none">{refusal || t('beat.refused', { reason: '' })}</Text>}
        {groups.map((group, groupIndex) => <View key={group.id} style={s.section}>
            <Text accessibilityRole="header">{t(`beatPiano.library.group.${group.id}`)}</Text>
            {group.presets.map((p, presetIndex) => {
                const tone = vividHue(VIVID_HUES[(groupIndex * 2 + presetIndex) % VIVID_HUES.length], scheme);
                return <View key={p.instrument.preset} style={[styles.preset, { backgroundColor: tone.fill, borderColor: tone.edge }]}>
                    <View style={[styles.instrumentIcon, { backgroundColor: tone.iconSurface }]}>
                        <Icon name="pianoKeys" size={24} tint={tone.foreground} />
                    </View>
                    <Text variant="bodyStrong" style={[styles.presetLabel, { color: tone.foreground }]}>{p.label}</Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('beatPiano.library.audition', { name: p.label })}
                        hitSlop={6}
                        style={({ pressed }) => [styles.action, { backgroundColor: tone.iconSurface }, pressed && styles.pressed]}
                        onPress={() => void audition(p.instrument)}
                    >
                        <Icon name="play" size={24} tint={tone.foreground} />
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('beatPiano.library.addNamed', { name: p.label })}
                        hitSlop={6}
                        style={({ pressed }) => [styles.action, { backgroundColor: tone.iconSurface }, pressed && styles.pressed]}
                        onPress={() => {
                        setNotice(null); setFailed(false);
                        if (apply(d => addInstrumentTrack(d, p.instrument), t('beatPiano.library.add'))) onClose();
                        else setFailed(true);
                        }}
                    >
                        <Icon name="plus" size={24} tint={tone.foreground} />
                    </Pressable>
                </View>;
            })}
        </View>)}
        {!groups.length && <Text>{t('beatPiano.library.empty')}</Text>}
    </BeatModal>;
}

const styles = StyleSheet.create({
    preset: {
        minHeight: 74,
        flexDirection: 'row',
        alignItems: 'center',
        gap: ds.space.sm,
        padding: ds.space.sm,
        borderRadius: ds.radius.lg,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
    },
    instrumentIcon: {
        width: 46,
        height: 46,
        borderRadius: ds.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
    },
    presetLabel: { flex: 1 },
    action: {
        width: 46,
        height: 46,
        borderRadius: ds.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
    },
    pressed: { opacity: 0.72, transform: [{ scale: ds.motion.pressScale }] },
});
