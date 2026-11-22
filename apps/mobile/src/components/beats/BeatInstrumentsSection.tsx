import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Button, Text, useThemedStyles } from '../ui';
import { BeatInstrumentLibrary } from './BeatInstrumentLibrary';
import { MidiClipPreview } from './MidiClipPreview';
import { pianoStyles } from './pianoStyles';
import { instrumentLabel, midiRegions } from '../../lib/beatNative/midi';
import type { BeatDoc, Edit } from '../../lib/beatNative/doc';
import type { BeatAudio } from '../../lib/beatNative/audio';
import { t } from '../../lib/i18n';
// Export navigation beside the section so the editor needs only one additive import.
export const openPiano = (id: string, region: string) => router.push({ pathname: '/beats/piano/[id]', params: { id, region } });
export function BeatInstrumentsSection({ doc, apply, audio, onOpen, disabled = false }: { doc: BeatDoc; apply(op: Edit, label?: string): boolean; audio(): BeatAudio | null; onOpen(region: string): void; disabled?: boolean }) {
    const [library, setLibrary] = useState(false);
    const s = useThemedStyles(pianoStyles);
    return <View style={s.section}>
        <Text accessibilityRole="header">{t('beatPiano.library.title')}</Text>
        <Button label={t('beatPiano.library.add')} disabled={disabled} onPress={() => setLibrary(true)} />
        {midiRegions(doc).map(({ track, region, clip }) => <View key={region.id} style={s.section}>
            <Text>{track.name}</Text><Text>{instrumentLabel(track.instrument)}</Text>
            {clip && <MidiClipPreview clip={clip} />}
            <Button label={t('beatPiano.library.edit', { name: track.name })} disabled={disabled} onPress={() => onOpen(region.id)} />
        </View>)}
        {library && <BeatInstrumentLibrary apply={apply} audio={audio} onClose={() => setLibrary(false)} />}
    </View>;
}
