import { Switch, Text, View } from 'react-native';
import { ds } from '../../../theme';
import { t, rawText, formatNumber } from '../../../lib/i18n';
import { SMART_PICTURE, type Smart } from '../../../lib/editorMotionEdit';
import type { Clip } from '../../../lib/nativeEditorModel';
import { exportRefusal } from '../../../lib/editorExportRefusal';
import { Action, PanelHeading } from '../EditorControls';
import { styles } from '../fullEditorStyles';
import { Slider } from './Slider';
import { ColourField } from './ColourField';
import type { MaskActions } from './useMaskActions';
export function SmartPictureSection({ clip, actions }: { clip: Clip; actions: MaskActions }) {
    const value = { ...SMART_PICTURE, ...clip.smartPicture };
    const labels = { denoise: t('editorMotion.denoise'), keyTolerance: t('editorMotion.keyTolerance'), keyFeather: t('editorMotion.keyFeather'),
        despill: t('editorMotion.despill'), light: t('editorMotion.light'), lightX: t('editorMotion.lightX'), lightY: t('editorMotion.lightY'),
        lightRadius: t('editorMotion.lightRadius') };
    const slider = (key: Exclude<keyof Smart, 'keyColor' | 'keyEnabled'>, min: number, max: number, step: number) =>
        <Slider label={labels[key]} value={value[key]} min={min} max={max} step={step}
            format={n => key === 'light' ? formatNumber(n, 1) : `${formatNumber(n * 100, 1)}%`} onChange={n => actions.smart(key, n)} />;
    return <View style={{ gap: ds.space.sm }}>
        <PanelHeading detail="" title={t('editorMotion.smart')} />
        {slider('denoise', 0, 1, .05)}
        <Text style={styles.fieldLabel}>{t('editorMotion.keyEnabled')}</Text>
        <Switch accessibilityLabel={rawText(t('editorMotion.keyEnabled'))} value={value.keyEnabled} onValueChange={v => { actions.smart('keyEnabled', v); }}
            style={{ minHeight: 44, minWidth: 44 }} />
        {value.keyEnabled ? <>
            <ColourField label={t('editorMotion.keyColor')} value={value.keyColor} swatches={['#00ff00', '#0000ff', '#ffffff', '#000000']}
                onChange={v => actions.smart('keyColor', v)} />
            {slider('keyTolerance', 0, 1, .01)}{slider('keyFeather', .001, 1, .01)}{slider('despill', 0, 1, .05)}
        </> : null}
        {slider('light', -2, 2, .1)}
        {value.light !== 0 ? <>{slider('lightX', 0, 1, .01)}{slider('lightY', 0, 1, .01)}{slider('lightRadius', .05, 2, .05)}</> : null}
        <Action label={t('editorMotion.resetSmart')} onPress={actions.resetSmart} />
        <Text style={styles.muted}>{t('editorMotion.smartHelp')}</Text>
        <Text style={styles.muted}>{t('editorMotion.smartNote')}</Text>
        {value.denoise !== 0 || value.keyEnabled || value.light !== 0 ? <Text style={styles.muted}>{exportRefusal('smartPicture')}</Text> : null}
    </View>;
}
