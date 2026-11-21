import { View } from 'react-native';
import { t } from '../../../lib/i18n';
import { ds } from '../../../theme';
import { Action } from '../EditorControls';
import { Slider } from './Slider';
import { LookHeading, percent, type LookContentProps } from './LookPanels';
export function CropSection({ clip, actions, disabled }: LookContentProps) {
    const crop = clip.crop ?? { x: 0, y: 0, width: 1, height: 1 };
    return <View style={{ gap: ds.space.md }}>
        <LookHeading>{t('editorLook.crop')}</LookHeading>
        {(['x', 'y', 'width', 'height'] as const).map(key => <Slider key={key} label={t(`editorLook.crop.${key}`)}
            value={crop[key]} min={key === 'width' || key === 'height' ? .05 : 0}
            max={key === 'x' ? 1 - crop.width : key === 'y' ? 1 - crop.height : 1} step={.01} format={percent}
            disabled={disabled} onChange={value => actions.crop({ ...crop, [key]: value })} />)}
        <Action label={t('editorLook.resetCrop')} disabled={disabled} onPress={actions.resetCrop} />
    </View>;
}
