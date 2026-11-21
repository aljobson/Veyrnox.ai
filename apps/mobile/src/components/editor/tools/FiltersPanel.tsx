import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { colourDefaults } from '../../../../../../app/veyrnox/_lib/editorColour.mjs';
import { PARAMETER_BOUNDS } from '../../../../../../app/veyrnox/_lib/editorAnimation.mjs';
import { t } from '../../../lib/i18n';
import { lookValues, type FilterKey } from '../../../lib/editorLookEdit';
import { ds } from '../../../theme';
import { useEditorFrame } from '../editorFrameStore';
import { Action } from '../EditorControls';
import { Slider } from './Slider';
import { HslSection } from './HslSection';
import { CurvesSection } from './CurvesSection';
import { LookHeading, LookMessage, percent, number, degrees, type LookContentProps } from './LookPanels';
const filters: FilterKey[] = ['brightness', 'contrast', 'saturate', 'hue', 'blur'];
const colours = ['exposure', 'temperature', 'tint'] as const;
const staticColours = ['shadows', 'highlights', 'gamma'] as const;
export function FiltersPanel(props: LookContentProps) {
    return <FilterControls {...props} />;
}
function FilterControls(props: LookContentProps) {
    const { clip, actions, disabled } = props;
    const curve = useRef(actions.curve);
    useLayoutEffect(() => { curve.current = actions.curve; }, [actions.curve]);
    const onCurve = useCallback<LookContentProps['actions']['curve']>((channel, points) => curve.current(channel, points), []);
    const colour = useMemo(() => clip.colourAdjustment ?? colourDefaults(), [clip.colourAdjustment]);
    return <View style={{ gap: ds.space.md }}>
        {clip.parameterKeyframes?.length ? <LookMessage>{t('editorLook.keyframes')}</LookMessage> : null}
        {clip.parameterKeyframes?.length ? <AnimatedFilters {...props} /> : <ParameterControls {...props} offset={0} />}
        {staticColours.map(key => <Slider key={key} label={t(`editorLook.parameter.${key}`)} value={colour[key]} disabled={disabled}
            min={key === 'gamma' ? .1 : -1} max={key === 'gamma' ? 4 : 1} step={key === 'gamma' ? .05 : .01}
            snaps={key === 'gamma' ? [1] : undefined} format={number} onChange={value => actions.colour(key, value)} />)}
        <HslSection colour={colour} actions={actions} disabled={disabled} />
        <CurvesSection colour={colour} onCurve={onCurve} disabled={disabled} />
        <Action label={t('editorLook.resetColour')} disabled={disabled} onPress={actions.resetColour} />
    </View>;
}
function AnimatedFilters(props: LookContentProps) {
    const frame = useEditorFrame(props.actions.frameStore);
    return <ParameterControls {...props} offset={frame - props.clip.start} />;
}
function ParameterControls({ clip, actions, disabled, offset }: LookContentProps & { offset: number }) {
    const values = useMemo(() => lookValues(clip, offset), [clip, offset]);
    return <>
        <LookHeading>{t('editorLook.filter')}</LookHeading>
        {filters.map(key => <Slider key={key} label={t(`editorLook.parameter.${key}`)} value={values.filter[key]} disabled={disabled}
            min={PARAMETER_BOUNDS[key][0]} max={PARAMETER_BOUNDS[key][1]} step={key === 'hue' ? 1 : key === 'blur' ? .5 : .05}
            format={key === 'hue' ? degrees : key === 'blur' ? number : percent} onChange={value => actions.filter(key, value)} />)}
        <Action label={t('editorLook.resetFilter')} disabled={disabled} onPress={actions.resetFilter} />
        <LookHeading>{t('editorLook.colour')}</LookHeading>
        {colours.map(key => <Slider key={key} label={t(`editorLook.parameter.${key}`)} value={values.colour[key]} disabled={disabled}
            min={PARAMETER_BOUNDS[key][0]} max={PARAMETER_BOUNDS[key][1]} step={key === 'exposure' ? .05 : .01}
            format={number} onChange={value => actions.colour(key, value)} />)}
    </>;
}
