import { useMemo } from 'react';
import { View } from 'react-native';
import { PARAMETER_BOUNDS } from '../../../../../../app/veyrnox/_lib/editorAnimation.mjs';
import { t } from '../../../lib/i18n';
import { lookValues, type ColourKey, type FilterKey } from '../../../lib/editorLookEdit';
import { ds } from '../../../theme';
import { useEditorFrame } from '../editorFrameStore';
import { Action } from '../EditorControls';
import { Slider } from './Slider';
import { HslSection } from './HslSection';
import { CurvesSection } from './CurvesSection';
import { LookHeading, LookMessage, percent, number, degrees, type LookContentProps } from './LookPanels';
const filters: FilterKey[] = ['brightness', 'contrast', 'saturate', 'hue', 'blur'];
const colours: ColourKey[] = ['exposure', 'temperature', 'tint', 'shadows', 'highlights', 'gamma'];
export function FiltersPanel(props: LookContentProps) {
    return props.clip.parameterKeyframes?.length ? <AnimatedFilters {...props} /> : <FilterControls {...props} offset={0} />;
}
function AnimatedFilters(props: LookContentProps) {
    const frame = useEditorFrame(props.actions.frameStore);
    return <FilterControls {...props} offset={frame - props.clip.start} />;
}
function FilterControls({ clip, actions, disabled, offset }: LookContentProps & { offset: number }) {
    const values = useMemo(() => lookValues(clip, offset), [clip, offset]);
    return <View style={{ gap: ds.space.md }}>
        {clip.parameterKeyframes?.length ? <LookMessage>{t('editorLook.keyframes')}</LookMessage> : null}
        <LookHeading>{t('editorLook.filter')}</LookHeading>
        {filters.map(key => <Slider key={key} label={t(`editorLook.parameter.${key}`)} value={values.filter[key]} disabled={disabled}
            min={PARAMETER_BOUNDS[key][0]} max={PARAMETER_BOUNDS[key][1]} step={key === 'hue' ? 1 : key === 'blur' ? .5 : .05}
            format={key === 'hue' ? degrees : key === 'blur' ? number : percent} onChange={value => actions.filter(key, value)} />)}
        <Action label={t('editorLook.resetFilter')} disabled={disabled} onPress={actions.resetFilter} />
        <LookHeading>{t('editorLook.colour')}</LookHeading>
        {colours.map(key => {
            const bounds = key === 'gamma' ? [.1, 4] : key === 'shadows' || key === 'highlights' ? [-1, 1] : PARAMETER_BOUNDS[key];
            return <Slider key={key} label={t(`editorLook.parameter.${key}`)} value={values.colour[key]} disabled={disabled}
                min={bounds[0]} max={bounds[1]} step={key === 'gamma' || key === 'exposure' ? .05 : .01}
                snaps={key === 'gamma' ? [1] : undefined} format={number} onChange={value => actions.colour(key, value)} />;
        })}
        <HslSection colour={values.colour} actions={actions} disabled={disabled} />
        <CurvesSection colour={values.colour} actions={actions} disabled={disabled} />
        <Action label={t('editorLook.resetColour')} disabled={disabled} onPress={actions.resetColour} />
    </View>;
}
