import { Text, View } from 'react-native';
import { t } from '../../../lib/i18n';

import { styles } from '../fullEditorStyles';
import { Choice, Stepper, PanelHeading, EmptyPanel } from '../EditorControls';

import type { ToolPanelProps } from './types';
export function AnimationPanel({ selection, selected, patchSelected }: Pick<ToolPanelProps, 'selection' | 'selected' | 'patchSelected'>) {
    return <>
        <PanelHeading title={t('editor.animation')} detail={selection ? t('editor.layermotion') : t('editor.selectalayer')} />
        {selection && selected ? <><Text style={styles.fieldLabel}>{t('editor.animatein')}</Text><View style={styles.choices}>{['none', 'fade', 'slide-left', 'zoom'].map((value) =>
            <Choice key={value} label={value} selected={(selected.animation?.in ?? 'none') === value} onPress={() => patchSelected({ animation: { ...selected.animation, in: value, out:
            selected.animation?.out ?? 'none', duration: selected.animation?.duration ?? 15 } })} />)}</View><Text style={styles.fieldLabel}>{t('editor.animateout')}</Text><View
            style={styles.choices}>{['none', 'fade', 'slide-right', 'zoom'].map((value) => <Choice key={value} label={value} selected={(selected.animation?.out ?? 'none') === value}
            onPress={() => patchSelected({ animation: { ...selected.animation, in: selected.animation?.in ?? 'none', out: value, duration: selected.animation?.duration ?? 15 } })}
            />)}</View><Stepper label={t('editor.animationduration')} value={selected.animation?.duration ?? 15} min={1} max={90} step={1} suffix={t('editor.frames')}
            onChange={(duration) => patchSelected({ animation: { ...selected.animation, in: selected.animation?.in ?? 'none', out: selected.animation?.out ?? 'none', duration } })} /></>
            : <EmptyPanel title={t('editor.selectalayer')} body={t('editor.animationcontrolsworkonvideoaudioand')} />}
    </>;
}
