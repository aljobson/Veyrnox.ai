import { useCallback, useRef, useState, type ComponentRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Text, useThemedStyles } from '../ui';
import { BeatInstrumentLibrary } from './BeatInstrumentLibrary';
import { MidiClipPreview } from './MidiClipPreview';
import { pianoStyles } from './pianoStyles';
import { instrumentLabel, midiTrackSections } from '../../lib/beatNative/midi';
import type { BeatDoc, Edit } from '../../lib/beatNative/doc';
import type { BeatAudio } from '../../lib/beatNative/audio';
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
export function BeatInstrumentsSection({ doc, apply, audio, onOpen, disabled = false, notice }: { doc: BeatDoc; apply(op: Edit, label?: string): boolean; audio(): BeatAudio | null; onOpen(region: string): void; disabled?: boolean; notice?: string | null }) {
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
        <Text accessibilityRole="header">{t('beatPiano.library.title')}</Text>
        <Button ref={trigger} label={t('beatPiano.library.add')} disabled={disabled} onPress={() => { restored.current = false; setLibrary(true); }} />
        {midiTrackSections(doc).map(({ track, clips }) => <View key={track.id} style={s.instrumentGroup}>
            <Text accessibilityRole="header">{track.name}</Text><Text>{instrumentLabel(track.instrument)}</Text>
            {clips.map(({ region, clip }) => <View key={region.id} style={s.section}>
                <MidiClipPreview clip={clip} />
                <Button label={t('beatPiano.library.edit', { name: `${track.name}: ${clip.name}` })} disabled={disabled} onPress={() => onOpen(region.id)} />
            </View>)}
        </View>)}
        {library && <BeatInstrumentLibrary apply={apply} audio={audio} onClose={closeLibrary} onDismiss={restoreFocus} refusal={notice} />}
    </View>;
}
