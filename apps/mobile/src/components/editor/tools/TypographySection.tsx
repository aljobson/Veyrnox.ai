import { StyleSheet, Switch, Text, View } from 'react-native';
import { t, formatNumber } from '../../../lib/i18n';
import { touchTarget } from '../../../lib/a11y';
import { mergedTextStyle } from '../../../lib/editorTextEdit';
import type { TextClip } from '../../../lib/nativeEditorModel';
import { ds } from '../../../theme';
import { styles } from '../fullEditorStyles';
import { ColourField } from './ColourField';
import { Slider } from './Slider';
import { TEXT_SWATCHES } from './TextStyleSection';
import type { TextActions } from './useTextActions';
export function TypographySection({ item, onChange }: { item: TextClip; onChange: TextActions['typography'] }) {
    const s = mergedTextStyle(item), number = (value: number) => formatNumber(value, 2);
    return <>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{t('editorText.typography')}</Text>
        <View style={local.toggle}><Text style={styles.fieldLabel}>{t('editorText.italic')}</Text>
            <Switch accessibilityLabel={t('editorText.italic')} value={s.italic} onValueChange={value => { onChange('italic', value); }} style={touchTarget} /></View>
        <View style={local.toggle}><Text style={styles.fieldLabel}>{t('editorText.underline')}</Text>
            <Switch accessibilityLabel={t('editorText.underline')} value={s.underline} onValueChange={value => { onChange('underline', value); }} style={touchTarget} /></View>
        <Slider label={t('editorText.letterSpacing')} value={s.letterSpacing} min={-10} max={30} step={.5}
            format={number} onChange={value => onChange('letterSpacing', value)} />
        <Slider label={t('editorText.lineHeight')} value={s.lineHeight} min={.8} max={3} step={.05}
            format={number} onChange={value => onChange('lineHeight', value)} />
        <ColourField label={t('editorText.shadowColor')} value={s.shadowColor} swatches={TEXT_SWATCHES} onChange={value => onChange('shadowColor', value)} />
        <Slider label={t('editorText.shadowOpacity')} value={s.shadowOpacity * 100} min={0} max={100} step={1}
            format={value => t('editorText.percent', { value: formatNumber(value, 0) })} onChange={value => onChange('shadowOpacity', value / 100)} />
        <Slider label={t('editorText.shadowBlur')} value={s.shadowBlur} min={0} max={30} step={1}
            format={number} onChange={value => onChange('shadowBlur', value)} />
        <Slider label={t('editorText.shadowX')} value={s.shadowX} min={-50} max={50} step={1}
            format={number} onChange={value => onChange('shadowX', value)} />
        <Slider label={t('editorText.shadowY')} value={s.shadowY} min={-50} max={50} step={1}
            format={number} onChange={value => onChange('shadowY', value)} />
    </>;
}
const local = StyleSheet.create({ toggle: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ds.space.sm } });
