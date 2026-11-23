import { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Button, Text, useThemedStyles } from '../ui';
import { pianoStyles } from './pianoStyles';
import { SNAP_OPTIONS, zoomStep } from '../../lib/beatNative/rollGeometry';
import { clipLengthFromBars, makeUnique, regionUses, setClipLength, type MidiClip, type MidiRegion } from '../../lib/beatNative/midi';
import type { BeatDoc, Edit } from '../../lib/beatNative/doc';
import { t } from '../../lib/i18n';
export function BeatPianoToolbar(p: { doc: BeatDoc; region: MidiRegion; clip: MidiClip; apply(op: Edit, label?: string): boolean; playing: boolean; togglePlay(): void; undo(): void; redo(): void; canUndo: boolean; canRedo: boolean; busy: boolean; snap: number; setSnap(n: number): void; strength: number; setStrength(n: number): void; quantise(): void; scale: number; setScale(n: number): void }) {
    const s = useThemedStyles(pianoStyles);
    const [draft, setDraft] = useState<string | null>(null);
    const pending = useRef<string | null>(null);
    useEffect(() => { pending.current = null; setDraft(null); }, [p.clip.lengthTicks, p.region.clipId]);
    const commit = () => {
        if (pending.current === null) return;
        const length = clipLengthFromBars(pending.current); pending.current = null; setDraft(null);
        if (length !== null && length !== p.clip.lengthTicks) p.apply(d => setClipLength(d, p.region.clipId, length), t('beatPiano.lengthChanged'));
    };
    return <View style={s.section}>
        <Text accessibilityRole="header">{p.clip.name}</Text>
        <Text>{t('beatPiano.uses', { n: regionUses(p.doc, p.region.clipId) })}</Text>
        <View style={s.row}>
            <Button label={t(p.playing ? 'beat.stop' : 'beat.play')} onPress={p.togglePlay} />
            <Button label={t('beat.undo')} disabled={p.busy || !p.canUndo} onPress={p.undo} />
            <Button label={t('beat.redo')} disabled={p.busy || !p.canRedo} onPress={p.redo} />
            <Button label={t('beatPiano.unique')} disabled={p.busy} onPress={() => p.apply(d => makeUnique(d, p.region.id), t('beatPiano.unique'))} />
        </View>
        <Text>{t('beatPiano.snap')}</Text>
        <View style={s.row} accessibilityRole="radiogroup" accessibilityLabel={t('beatPiano.snap')}>{SNAP_OPTIONS.map(snap => {
            const checked = p.snap === snap;
            return <Button key={snap} label={snap ? t('beatPiano.snapValue', { n: 3840 / snap }) : t('beatPiano.off')} variant="secondary" icon={checked ? 'check' : undefined} style={checked ? s.choiceSelected : undefined} accessibilityRole="radio" accessibilityState={{ checked }} onPress={() => p.setSnap(snap)} />;
        })}</View>
        <View style={s.row}>
            <View style={s.row} accessibilityRole="radiogroup" accessibilityLabel={t('beatPiano.quantise')}>
                {[1, 0.5].map(strength => {
                    const checked = p.strength === strength;
                    return <Button key={strength} label={t('beatPiano.strength', { n: strength * 100 })} variant="secondary" icon={checked ? 'check' : undefined} style={checked ? s.choiceSelected : undefined} accessibilityRole="radio" accessibilityState={{ checked }} onPress={() => p.setStrength(strength)} />;
                })}
            </View>
            <Button label={t('beatPiano.quantise')} disabled={!p.snap || p.busy} onPress={p.quantise} />
        </View>
        <Text>{t('beatPiano.bars')}</Text>
        <TextInput style={s.field} accessibilityLabel={t('beatPiano.bars')} keyboardType="decimal-pad" editable={!p.busy} value={draft ?? String(p.clip.lengthTicks / 3840)} onChangeText={v => { pending.current = v; setDraft(v); }} onBlur={commit} onSubmitEditing={commit} />
        <View style={s.row}>
            <Button label={t('beatPiano.zoomOut')} onPress={() => p.setScale(zoomStep(p.scale, -1))} />
            <Button label={t('beatPiano.zoomIn')} onPress={() => p.setScale(zoomStep(p.scale, 1))} />
        </View>
    </View>;
}
