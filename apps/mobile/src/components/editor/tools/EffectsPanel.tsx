import { View } from 'react-native';
import { VIDEO_EFFECTS, EFFECT_CATEGORIES } from '../../../../../../app/veyrnox/_lib/editorEffects.mjs';
import { BLENDS } from '../../../../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { t } from '../../../lib/i18n';
import { ds } from '../../../theme';
import { Slider } from './Slider';
import { CropSection } from './CropSection';
import { ClipBackgroundSection } from './ClipBackgroundSection';
import { LookChoice, percent, type LookContentProps } from './LookPanels';
export function EffectsPanel(props: LookContentProps) {
    const { clip, actions, disabled } = props, selected = clip.effect?.type ?? 'none';
    return <View style={{ gap: ds.space.md }}>
        {EFFECT_CATEGORIES.filter(category => category !== 'All').map(category => <LookChoice key={category}
            label={t(`editorLook.category.${category}`)} value={selected} disabled={disabled} onChange={actions.effect}
            options={VIDEO_EFFECTS.filter(effect => effect.category === category).map(effect => ({ value: effect.id, label: t(`editorLook.effect.${effect.id}`) }))} />)}
        <Slider label={t('editorLook.intensity')} value={clip.effect?.intensity ?? .5} min={0} max={1} step={.05}
            format={percent} disabled={disabled || selected === 'none'} onChange={actions.intensity} />
        <LookChoice label={t('editorLook.blend')} value={clip.blend ?? 'source-over'} disabled={disabled} onChange={actions.blend}
            options={BLENDS.map(id => ({ value: id, label: t(`editorLook.blend.${id}`) }))} />
        <CropSection {...props} /><ClipBackgroundSection {...props} />
    </View>;
}
