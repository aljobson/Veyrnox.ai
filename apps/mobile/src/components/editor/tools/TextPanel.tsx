import { Pressable, Text, View } from 'react-native';
import { t, plural } from '../../../lib/i18n';
import { touchTarget } from '../../../lib/a11y';
import { styles } from '../fullEditorStyles';
import { Choice, Stepper, LabeledInput, PanelHeading } from '../EditorControls';

import type { ToolPanelProps } from './types';
import { TEXT_DEFAULTS } from '../../../../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
export function TextPanel({ timeline, selection, selected, addText, updateSelectedText, patchSelected }: Pick<ToolPanelProps, 'timeline' | 'selection' | 'selected' | 'addText' |
    'updateSelectedText' | 'patchSelected'>) {
    return <>
        <PanelHeading title={t('editor.text2')} detail={selection?.track === 'text' ? t('editor.layerselected') : plural('editor.textLayersCount', timeline.text.length)} />
        <Pressable accessibilityRole="button" accessibilityLabel={t('editor.addText')} style={({ pressed }) => [styles.primary, touchTarget, pressed && styles.pressed]}
            onPress={addText}><Text style={styles.primaryText}>＋ {t('editor.addText')}</Text></Pressable>
        {selection?.track === 'text' && selected && 'text' in selected ? <>
            <LabeledInput label={t('editor.words')} value={selected.text} onChangeText={updateSelectedText} />
            <Stepper label={t('editor.textsize')} value={selected.size} min={2} max={40} step={1} onChange={(size) => patchSelected({ size })} />
            <Stepper label={t('editor.horizontalposition')} value={selected.x * 100} min={0} max={100} step={5} suffix="%" onChange={(value) => patchSelected({ x: value / 100 })} />
            <Stepper label={t('editor.verticalposition')} value={selected.y * 100} min={0} max={100} step={5} suffix="%" onChange={(value) => patchSelected({ y: value / 100 })} />
            <Text style={styles.fieldLabel}>{t('editor.weight')}</Text><View style={styles.choices}>{['normal', 'bold'].map((value) => <Choice key={value} label={value}
                selected={(selected.style?.weight ?? 'bold') === value} onPress={() => patchSelected({ style: { ...TEXT_DEFAULTS, ...selected.style, weight: value } })} />)}</View>
            <Text style={styles.fieldLabel}>{t('editor.alignment')}</Text><View style={styles.choices}>{['left', 'center', 'right'].map((value) => <Choice key={value} label={value}
                selected={(selected.style?.align ?? 'center') === value} onPress={() => patchSelected({ style: { ...TEXT_DEFAULTS, ...selected.style, align: value } })} />)}</View>
        </> : <Text style={styles.body}>{t('editor.selectatextlayeronthetimeline')}</Text>}
    </>;
}
