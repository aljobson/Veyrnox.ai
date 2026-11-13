import { View } from 'react-native';
import { t } from '../../lib/i18n';
import { MAKEUP, HAIR_SHADES, type Stack, type MakeupId } from '../../lib/liveEdit/engine';
import { Button, Text } from '../ui';
import { themedStyles, useThemedStyles } from '../ui/AppearanceContext';
import { StrengthSlider } from '../StrengthSlider';
import { ds } from '../../theme';
export function EffectControls({ value, onChange, onChangeStart, onChangeEnd, face, hair, disabled }: { value: Stack; onChange(s: Stack): void; onChangeStart(): void; onChangeEnd(): void; face: boolean; hair: boolean; disabled: boolean }) {
    const styles = useThemedStyles(sheets);
    const labels = { foundation: t('liveEdit.foundation'), blush: t('liveEdit.blush'), eyeshadow: t('liveEdit.eyeshadow'), brows: t('liveEdit.brows'), eyeliner: t('liveEdit.eyeliner'), lashes: t('liveEdit.lashes'), lips: t('liveEdit.lips') };
    const update = (id: MakeupId, patch: Partial<Stack['makeup'][MakeupId]>) => onChange({ ...value, makeup: { ...value.makeup, [id]: { ...value.makeup[id], ...patch } } });
    return <View style={styles.body}>
        <Text>{t('liveEdit.smoothing')}</Text>
        <StrengthSlider onChangeStart={onChangeStart} onChangeEnd={onChangeEnd} tone="surface" value={value.smoothing} label={t('liveEdit.smoothing')} disabled={disabled || !face} onChange={smoothing => onChange({ ...value, smoothing })} />
        {MAKEUP.map(({ id, shades }) => <View key={id} style={styles.section}>
            <Text variant="title3">{labels[id]}</Text>
            <StrengthSlider onChangeStart={onChangeStart} onChangeEnd={onChangeEnd} tone="surface" value={value.makeup[id].strength} label={labels[id]} disabled={disabled || !face} onChange={strength => update(id, { strength })} />
            <View style={styles.row}>{shades.map((shade, n) => <Button key={shade} size="md" variant="secondary" label={t('liveEdit.shade', { n: String(n + 1) })} tone={value.makeup[id].shade === shade ? 'accent' : 'primary'} accessibilityState={{ selected: value.makeup[id].shade === shade }} disabled={disabled || !face} onPress={() => update(id, { shade })} />)}</View>
            {id === 'eyeshadow' ? <View style={styles.row}>{shades.map((shade2, n) => <Button key={shade2} size="md" variant="secondary" label={t('liveEdit.secondShade', { n: String(n + 1) })} tone={value.makeup[id].shade2 === shade2 ? 'accent' : 'primary'} accessibilityState={{ selected: value.makeup[id].shade2 === shade2 }} disabled={disabled || !face} onPress={() => update(id, { shade2 })} />)}</View> : null}
            {id === 'lips' ? <View style={styles.row}>{[{ id: 'matte', name: t('liveEdit.matte') }, { id: 'gloss', name: t('liveEdit.gloss') }, { id: 'tint', name: t('liveEdit.tint') }].map(f => <Button key={f.id} size="md" variant="secondary" label={f.name} tone={value.makeup.lips.finish === f.id ? 'accent' : 'primary'} accessibilityState={{ selected: value.makeup.lips.finish === f.id }} disabled={disabled || !face} onPress={() => update('lips', { finish: f.id })} />)}</View> : null}
            {id === 'eyeliner' ? <><Text>{t('liveEdit.wing')}</Text><StrengthSlider onChangeStart={onChangeStart} onChangeEnd={onChangeEnd} tone="surface" label={t('liveEdit.wing')} value={value.makeup.eyeliner.wing ?? .4} disabled={disabled || !face} onChange={wing => update('eyeliner', { wing })} /></> : null}
            {id === 'lashes' ? <><Text>{t('liveEdit.volume')}</Text><StrengthSlider onChangeStart={onChangeStart} onChangeEnd={onChangeEnd} tone="surface" label={t('liveEdit.volume')} value={value.makeup.lashes.volume ?? .5} disabled={disabled || !face} onChange={volume => update('lashes', { volume })} /></> : null}
        </View>)}
        <Text variant="title3">{t('liveEdit.hair')}</Text>
        <StrengthSlider onChangeStart={onChangeStart} onChangeEnd={onChangeEnd} tone="surface" label={t('liveEdit.hair')} value={value.hair.strength} disabled={disabled || !hair} onChange={strength => onChange({ ...value, hair: { ...value.hair, strength } })} />
        <View style={styles.row}>{Object.keys(HAIR_SHADES).map((shade, n) => <Button key={shade} size="md" variant="secondary" label={t('liveEdit.shade', { n: String(n + 1) })} tone={value.hair.shade === shade ? 'accent' : 'primary'} accessibilityState={{ selected: value.hair.shade === shade }} disabled={disabled || !hair} onPress={() => onChange({ ...value, hair: { ...value.hair, shade } })} />)}</View>
        <View style={styles.row}>{Object.keys(HAIR_SHADES).map((shade2, n) => <Button key={shade2} size="md" variant="secondary" label={t('liveEdit.secondShade', { n: String(n + 1) })} tone={value.hair.shade2 === shade2 ? 'accent' : 'primary'} accessibilityState={{ selected: value.hair.shade2 === shade2 }} disabled={disabled || !hair} onPress={() => onChange({ ...value, hair: { ...value.hair, shade2 } })} />)}</View>
        <View style={styles.row}>{[{ id: 'solid', name: t('liveEdit.solid') }, { id: 'ombre', name: t('liveEdit.ombre') }, { id: 'highlights', name: t('liveEdit.highlights') }].map(mode => <Button key={mode.id} size="md" variant="secondary" label={mode.name} tone={value.hair.mode === mode.id ? 'accent' : 'primary'} accessibilityState={{ selected: value.hair.mode === mode.id }} disabled={disabled || !hair} onPress={() => onChange({ ...value, hair: { ...value.hair, mode: mode.id } })} />)}</View>
    </View>;
}
const sheets = themedStyles(() => ({ body: { gap: ds.space.md }, section: { gap: ds.space.sm, paddingTop: ds.space.xxl }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm } }));
