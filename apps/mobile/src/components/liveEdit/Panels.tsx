import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { t } from '../../lib/i18n';
import { HAIR_SHADES, MAKEUP, SHADES, type MakeupId, type Stack } from '../../lib/liveEdit/engine';
import { ds } from '../../theme';
import { Button, SegmentedControl, Text } from '../ui';
import { themedStyles, useThemedStyles } from '../ui/AppearanceContext';
import { Dial } from './Dial';
import { ShadeDots } from './ShadeDots';

export interface PanelProps { stack: Stack; onChange(next: Stack): void; onChangeStart(): void; onChangeEnd(): void; face: boolean; hair: boolean; disabled: boolean }

// Skin smoothing: one dial, like the Adjust tools in Photos.
export function RetouchPanel({ stack, onChange, onChangeStart, onChangeEnd, face, disabled }: PanelProps) {
    return <Dial label={t('liveEdit.smoothing')} value={stack.smoothing} disabled={disabled || !face} onChangeStart={onChangeStart} onChangeEnd={onChangeEnd} onChange={smoothing => onChange({ ...stack, smoothing })} />;
}

export function MakeupPanel({ stack, onChange, onChangeStart, onChangeEnd, face, disabled }: PanelProps) {
    const s = useThemedStyles(sheets);
    const [id, setId] = useState<MakeupId>('lips');
    const names: Record<MakeupId, string> = { foundation: t('liveEdit.foundation'), blush: t('liveEdit.blush'), eyeshadow: t('liveEdit.eyeshadow'), brows: t('liveEdit.brows'), eyeliner: t('liveEdit.eyeliner'), lashes: t('liveEdit.lashes'), lips: t('liveEdit.lips') };
    const item = MAKEUP.find(entry => entry.id === id) ?? MAKEUP[0]!, value = stack.makeup[item.id], off = disabled || !face;
    const update = (patch: Partial<Stack['makeup'][MakeupId]>) => onChange({ ...stack, makeup: { ...stack.makeup, [item.id]: { ...value, ...patch } } });
    return (
        <View style={s.panel}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
                {MAKEUP.map(entry => <Pressable key={entry.id} accessibilityRole="tab" accessibilityLabel={names[entry.id]} accessibilityState={{ selected: entry.id === item.id }} onPress={() => setId(entry.id)} style={[s.chip, entry.id === item.id && s.chipOn]}><Text variant="footnote" tone={entry.id === item.id ? 'primary' : 'secondary'}>{names[entry.id]}</Text></Pressable>)}
            </ScrollView>
            <ShadeDots shades={item.shades} colours={SHADES} selected={value.shade} disabled={off} onSelect={shade => update({ shade })} />
            {item.id === 'eyeshadow' ? <ShadeDots second shades={item.shades} colours={SHADES} selected={value.shade2} disabled={off} onSelect={shade2 => update({ shade2 })} /> : null}
            {item.id === 'lips' ? <SegmentedControl value={value.finish ?? 'matte'} onChange={finish => update({ finish })} options={[{ value: 'matte', label: t('liveEdit.matte') }, { value: 'gloss', label: t('liveEdit.gloss') }, { value: 'tint', label: t('liveEdit.tint') }]} /> : null}
            <Dial label={names[item.id]} value={value.strength} disabled={off} onChangeStart={onChangeStart} onChangeEnd={onChangeEnd} onChange={strength => update({ strength })} />
            {item.id === 'eyeliner' ? <Dial label={t('liveEdit.wing')} value={value.wing ?? .4} disabled={off} onChangeStart={onChangeStart} onChangeEnd={onChangeEnd} onChange={wing => update({ wing })} /> : null}
            {item.id === 'lashes' ? <Dial label={t('liveEdit.volume')} value={value.volume ?? .5} disabled={off} onChangeStart={onChangeStart} onChangeEnd={onChangeEnd} onChange={volume => update({ volume })} /> : null}
        </View>
    );
}

export function HairPanel({ stack, onChange, onChangeStart, onChangeEnd, hair, disabled, live }: PanelProps & { live: boolean }) {
    const s = useThemedStyles(sheets), off = disabled || !hair, shades = Object.keys(HAIR_SHADES);
    const update = (patch: Partial<Stack['hair']>) => onChange({ ...stack, hair: { ...stack.hair, ...patch } });
    return (
        <View style={s.panel}>
            {live ? <Text variant="footnote" tone="secondary" style={s.note}>{t('liveEdit.camera.hairNote')}</Text> : null}
            <ShadeDots shades={shades} colours={HAIR_SHADES} selected={stack.hair.shade} disabled={off} onSelect={shade => update({ shade })} />
            <SegmentedControl value={stack.hair.mode} onChange={mode => update({ mode })} options={[{ value: 'solid', label: t('liveEdit.solid') }, { value: 'ombre', label: t('liveEdit.ombre') }, { value: 'highlights', label: t('liveEdit.highlights') }]} />
            {stack.hair.mode !== 'solid' ? <ShadeDots second shades={shades} colours={HAIR_SHADES} selected={stack.hair.shade2} disabled={off} onSelect={shade2 => update({ shade2 })} /> : null}
            <Dial label={t('liveEdit.hair')} value={stack.hair.strength} disabled={off} onChangeStart={onChangeStart} onChangeEnd={onChangeEnd} onChange={strength => update({ strength })} />
        </View>
    );
}

// Realistic wigs are drawn by the server's image model, not on the phone: it costs credits and uploads the photo, so this only opens the existing Face Filters flow (which shows the price and asks for consent) with the current photo.
export function AiWigPanel({ onOpen, disabled }: { onOpen: () => void; disabled: boolean }) {
    const s = useThemedStyles(sheets);
    return (
        <View style={s.panel}>
            <Text variant="title3" style={s.note}>{t('liveEdit.aiWig.title')}</Text>
            <Text variant="footnote" tone="secondary" style={s.note}>{t('liveEdit.aiWig.help')}</Text>
            <Button label={t('liveEdit.aiWig.open')} disabled={disabled} onPress={onOpen} />
        </View>
    );
}
const sheets = themedStyles(p => ({
    panel: { gap: ds.space.sm },
    note: { textAlign: 'center', paddingHorizontal: ds.space.gutter },
    chips: { gap: ds.space.sm, paddingHorizontal: ds.space.gutter },
    chip: { minHeight: 44, paddingHorizontal: ds.space.lg, borderRadius: ds.radius.pill, alignItems: 'center', justifyContent: 'center' },
    chipOn: { backgroundColor: p.surface },
}));
