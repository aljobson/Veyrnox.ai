import { View } from 'react-native';
import { t } from '../../../lib/i18n';

import { styles } from '../fullEditorStyles';
import { Choice, Stepper, PanelHeading, EmptyPanel } from '../EditorControls';

import { type Clip } from '../../../lib/nativeEditorModel';

import type { ToolPanelProps } from './types';
export function EffectsPanel({ selection, selected, patchSelected }: Pick<ToolPanelProps, 'selection' | 'selected' | 'patchSelected'>) {
    return <>
        <PanelHeading title={t('editor.effects')} detail={selection ? t('editor.selectedlayer') : t('editor.selectaclip')} />
        {selection && selected && selection.track !== 'text' ? <><View style={styles.choices}>{[{ id: 'none', label: t('editor.none') }, { id: 'soft-glow', label: t('editor.softglow') },
            { id: 'grain', label: t('editor.filmgrain') }, { id: 'vignette', label: t('editor.vignette') }, { id: 'old-film', label: t('editor.oldfilm') }].map(({ id, label }) => <Choice
            key={id} label={label} selected={(selected as Clip).effect?.type === id || (id === 'none' && !(selected as Clip).effect)} onPress={() => patchSelected({ effect: id === 'none'
            ? undefined : { type: id, intensity: .5 } })} />)}</View>{(selected as Clip).effect ? <Stepper label={t('editor.effectintensity')} value={(selected as Clip).effect!.intensity
            * 100} min={0} max={100} step={5} suffix="%" onChange={(value) => patchSelected({ effect: { ...(selected as Clip).effect!, intensity: value / 100 } })} /> : null}</> :
            <EmptyPanel title={t('editor.choosevideooraudio')} body={t('editor.effectsarestoredontheselectedlayer')} />}
    </>;
}
export function TransitionsPanel({ selection, selected, patchSelected }: Pick<ToolPanelProps, 'selection' | 'selected' | 'patchSelected'>) {
    return <>
        <PanelHeading title={t('editor.transitions')} detail={selection?.track === 'video' ? t('editor.videoclipselected') : t('editor.selectavideoclip')} />
        {selection?.track === 'video' && selected ? <><View style={styles.choices}>{[{ id: 'dissolve', label: t('editor.dissolve') }, { id: 'dip-black', label: t('editor.diptoblack') },
            { id: 'wipe-left', label: t('editor.wipeleft') }, { id: 'slide-left', label: t('editor.slideleft') }].map(({ id, label }) => <Choice key={id} label={label}
            selected={((selected as Clip).transitionType ?? 'dissolve') === id} onPress={() => patchSelected({ transitionType: id })} />)}</View><Stepper label={t('editor.duration2')}
            value={(selected as Clip).transition ?? 0} min={0} max={60} step={5} suffix={t('editor.frames')} onChange={(transition) => patchSelected({ transition })} /></> : <EmptyPanel
            title={t('editor.chooseavideoclip')} body={t('editor.transitionsjoinadjacentclipsonthesame')} />}
    </>;
}
export function FiltersPanel({ selection, selected, patchSelected }: Pick<ToolPanelProps, 'selection' | 'selected' | 'patchSelected'>) {
    const filterOf = (clip: Clip) => ({ brightness: 1, contrast: 1, saturate: 1, hue: 0, blur: 0, ...clip.filter });
    return <>
        <PanelHeading title={t('editor.filters')} detail={selection?.track === 'video' ? t('editor.colourcontrols') : t('editor.selectavideoclip')} />
        {selection?.track === 'video' && selected ? <>{(['brightness', 'contrast', 'saturate'] as const).map((key) => <Stepper key={key} label={key} value={filterOf(selected as
            Clip)[key]} min={0} max={3} step={0.1} onChange={(value) => patchSelected({ filter: { ...filterOf(selected as Clip), [key]: value } })} />)}<Stepper label={t('editor.hue')}
            value={filterOf(selected as Clip).hue} min={-180} max={180} step={10} suffix="°" onChange={(value) => patchSelected({ filter: { ...filterOf(selected as Clip), hue: value }
            })} /><Stepper label={t('editor.blur')} value={filterOf(selected as Clip).blur} min={0} max={30} step={1} onChange={(value) => patchSelected({ filter: { ...filterOf(selected as
                Clip), blur: value } })} /></> : <EmptyPanel title={t('editor.chooseavideoclip')} body={t('editor.brightnesscontrastsaturationhueandblurmatch')} />}
    </>;
}
