import { useCallback, useRef, useState, type ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Text, useThemedStyles } from '../ui';
import { BeatInstrumentLibrary } from './BeatInstrumentLibrary';
import { MidiClipPreview } from './MidiClipPreview';
import { pianoStyles } from './pianoStyles';
import { instrumentLabel, midiTrackSections } from '../../lib/beatNative/midi';
import type { BeatDoc, Edit } from '../../lib/beatNative/doc';
import { t } from '../../lib/i18n';
// Export navigation beside the section so the editor needs only one additive import.
export const openPiano = (id: string, region: string) => router.push({ pathname: '/beats/piano/[id]', params: { id, region } });
export function restoreInstrumentLibraryTriggerFocus(
    trigger: ComponentRef<typeof Pressable> | null,
    resolve: (target: ComponentRef<typeof Pressable> | null) => number | null | undefined = findNodeHandle,
    focus: (node: number) => void = node => AccessibilityInfo.setAccessibilityFocus(node),
) {
    const node = resolve(trigger);
    if (node) focus(node);
}
export function BeatInstrumentsSection({ doc, apply, onOpen, disabled = false, notice }: { doc: BeatDoc; apply(op: Edit, label?: string): boolean; onOpen(region: string): void; disabled?: boolean; notice?: string | null }) {
    const [library, setLibrary] = useState(false);
    const trigger = useRef<ComponentRef<typeof Pressable>>(null);
    const restored = useRef(false);
    const restoreFocus = useCallback(() => {
        if (restored.current) return;
        restored.current = true;
        restoreInstrumentLibraryTriggerFocus(trigger.current);
    }, []);
    const closeLibrary = useCallback(() => {
        setLibrary(false);
        requestAnimationFrame(restoreFocus);
    }, [restoreFocus]);
    const s = useThemedStyles(pianoStyles);
    return <View style={s.section}>
        <View style={s.sectionHeader}>
            <Text accessibilityRole="header">{t('beatPiano.library.title')}</Text>
            <Button ref={trigger} label={t('beatPiano.library.add')} accessibilityLabel={t('beatPiano.library.add')}
                icon="plus" iconOnly size="md" variant="secondary" disabled={disabled}
                onPress={() => { restored.current = false; setLibrary(true); }} />
        </View>
        {midiTrackSections(doc).map(({ track, clips }) => <View key={track.id} style={s.instrumentGroup}>
            <View style={s.sectionHeader}><View style={s.presetName}>
                <Text accessibilityRole="header" variant="bodyStrong">{track.name}</Text><Text tone="secondary">{instrumentLabel(track.instrument)}</Text>
            </View>{clips[0] ? <Button label={t('beatPiano.library.edit', { name: `${track.name}: ${clips[0].clip.name}` })}
                accessibilityLabel={t('beatPiano.library.edit', { name: `${track.name}: ${clips[0].clip.name}` })}
                icon="pianoKeys" iconOnly size="md" variant="tertiary" disabled={disabled} onPress={() => onOpen(clips[0].region.id)} /> : null}</View>
            {clips.map(({ region, clip }) => <View key={region.id} style={s.section}>
                <MidiClipPreview clip={clip} />
            </View>)}
        </View>)}
        {library && <BeatInstrumentLibrary apply={apply} onClose={closeLibrary} onDismiss={restoreFocus} refusal={notice} />}
    </View>;
}
