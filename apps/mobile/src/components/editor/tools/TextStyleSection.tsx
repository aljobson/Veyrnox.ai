import { Text, View } from 'react-native';
import { TEXT_FONTS } from '../../../../../../app/veyrnox/_lib/editorTextStyle.mjs';
import { t, rawText, formatNumber } from '../../../lib/i18n';
import { touchTarget } from '../../../lib/a11y';
import { mergedTextStyle } from '../../../lib/editorTextEdit';
import type { CustomFont, TextClip } from '../../../lib/nativeEditorModel';
import { styles } from '../fullEditorStyles';
import { SegmentedChoice } from './SegmentedChoice';
import { ColourField } from './ColourField';
import { Slider } from './Slider';
import type { TextActions } from './useTextActions';
export const TEXT_SWATCHES = Object.freeze(['#ffffff', '#000000', '#ffe66d', '#32d6c5', '#ff8bd1', '#c62828', '#101827']);
export function TextStyleSection({ item, fonts = [], fontReady, fontFailed, fontChecking = false, organizationAvailable = false, onChange }: { item: TextClip;
    fonts?: readonly CustomFont[]; fontReady?(family: string): boolean; fontFailed?(family: string): boolean; fontChecking?: boolean; organizationAvailable?: boolean;
    onChange: TextActions['style'] }) {
    const s = mergedTextStyle(item);
    const custom = fonts.find(font => font.family === s.font);
    const customStatus = fontChecking ? t('editorFont.checking') : fontFailed?.(s.font) ? t('editorFont.unsupportedOnIphone') : fontReady?.(s.font) ? t('editorFont.ready') :
        t('editorFont.relinkNeeded');
    const customNote = organizationAvailable && custom ? customStatus : t('editorText.customFontNote');
    const fontLabel = (font: string) => font === 'sans-serif' ? t('editorText.sansSerif')
        : font === 'serif' ? t('editorText.serif') : font === 'monospace' ? t('editorText.monospace') : rawText(font);
    return <>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{t('editorText.style')}</Text>
        <SegmentedChoice label={t('editorText.font')} value={s.font} options={TEXT_FONTS.map(value => ({ value, label: fontLabel(value) }))}
            onChange={value => onChange('font', value)} />
        {s.font.startsWith('VXFont_') ? <>
            <View accessible accessibilityLabel={rawText(`${custom?.name ?? t('editorText.customFont')}. ${customNote}`)} accessibilityState={{ selected: true, disabled: true }}
                style={[styles.choice, styles.choiceSelected, touchTarget]}><Text style={[styles.choiceTextSelected, fontReady?.(s.font) && { fontFamily: s.font }]}>{custom?.name ??
                    t('editorText.customFont')}</Text></View>
            <Text style={[styles.panelDetail, { fontSize: 12 }]}>{customNote}</Text>
        </> : null}
        <ColourField label={t('editorText.color')} value={s.color} swatches={TEXT_SWATCHES} onChange={value => onChange('color', value)} />
        <ColourField label={t('editorText.stroke')} value={s.stroke} swatches={TEXT_SWATCHES} onChange={value => onChange('stroke', value)} />
        <Slider label={t('editorText.strokeWidth')} value={s.strokeWidth} min={0} max={12} step={.5}
            format={value => formatNumber(value, 1)} onChange={value => onChange('strokeWidth', value)} />
        <ColourField label={t('editorText.background')} value={s.background} swatches={TEXT_SWATCHES} onChange={value => onChange('background', value)} />
        <Slider label={t('editorText.backgroundOpacity')} value={s.backgroundOpacity * 100} min={0} max={100} step={1}
            format={value => t('editorText.percent', { value: formatNumber(value, 0) })} onChange={value => onChange('backgroundOpacity', value / 100)} />
    </>;
}
