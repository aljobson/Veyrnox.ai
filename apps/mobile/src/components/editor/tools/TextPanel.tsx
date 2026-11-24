import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { t, plural } from '../../../lib/i18n';
import { touchTarget } from '../../../lib/a11y';
import { styles } from '../fullEditorStyles';
import { Action, Choice, Stepper, LabeledInput, PanelHeading } from '../EditorControls';

import type { ToolPanelProps } from './types';
import { TextStyleCatalog } from './TextStyleCatalog';
import { TextStyleSection } from './TextStyleSection';
import { TypographySection } from './TypographySection';
import { documentIdentity } from '../../../lib/editorBridge';
import { SERVER_PLAIN_TEXT_STYLE } from '../../../lib/editorServerExport';
import { exportRefusal } from '../../../lib/editorExportRefusal';
import { CustomFontLibrarySheet } from '../fonts/CustomFontLibrarySheet';
import { validCustomFonts } from '../../../lib/nativeEditorModel';
import { TEXT_GUIDES } from '../../../../../../app/veyrnox/_lib/editorTextGuides.mjs';
import { BehindSubjectSection } from './BehindSubjectSection';
export function TextPanel({ timeline, selection, selected, addText, updateSelectedText, patchSelected, textActions, fontActions }: Pick<ToolPanelProps, 'timeline' | 'selection' | 'selected' | 'addText' |
    'updateSelectedText' | 'patchSelected' | 'textActions' | 'fontActions'>) {
    const [fontsOpen, setFontsOpen] = useState(false);
    const customFonts = validCustomFonts(timeline);
    return <>
        <PanelHeading title={t('editor.text2')} detail={selection?.track === 'text' ? t('editor.layerselected') : plural('editor.textLayersCount', timeline.text.length)} />
        <Pressable accessibilityRole="button" accessibilityLabel={t('editor.addText')} style={({ pressed }) => [styles.primary, touchTarget, pressed && styles.pressed]}
            onPress={addText}><Text style={styles.primaryText}>＋ {t('editor.addText')}</Text></Pressable>
        <TextStyleCatalog onInsert={name => textActions?.insertPreset(name)} />
        {selection?.track === 'text' && selected && 'text' in selected ? <>
            <LabeledInput label={t('editor.words')} value={selected.text} onChangeText={updateSelectedText} />
            <Stepper label={t('editor.textsize')} value={selected.size} min={2} max={40} step={1} onChange={(size) => patchSelected({ size })} />
            <Stepper label={t('editor.horizontalposition')} value={selected.x * 100} min={0} max={100} step={5} suffix="%" onChange={(value) => patchSelected({ x: value / 100 })} />
            <Stepper label={t('editor.verticalposition')} value={selected.y * 100} min={0} max={100} step={5} suffix="%" onChange={(value) => patchSelected({ y: value / 100 })} />
            <Text style={styles.fieldLabel}>{t('editor.snap')} · {t('editor.horizontalposition')}</Text><View style={styles.choices}>{TEXT_GUIDES.map(value => <Choice key={value}
                label={`${t('editor.axisX')} ${value * 100}%`} selected={selected.x === value} onPress={() => patchSelected({ x: value })} />)}</View>
            <Text style={styles.fieldLabel}>{t('editor.snap')} · {t('editor.verticalposition')}</Text><View style={styles.choices}>{TEXT_GUIDES.map(value => <Choice key={value}
                label={`${t('editor.axisY')} ${value * 100}%`} selected={selected.y === value} onPress={() => patchSelected({ y: value })} />)}</View>
            <Text style={styles.fieldLabel}>{t('editor.weight')}</Text><View style={styles.choices}>{['normal', 'bold'].map((value) => <Choice key={value} label={value}
                selected={(selected.style?.weight ?? 'bold') === value} onPress={() => textActions?.style('weight', value)} />)}</View>
            <Text style={styles.fieldLabel}>{t('editor.alignment')}</Text><View style={styles.choices}>{['left', 'center', 'right'].map((value) => <Choice key={value} label={value}
                selected={(selected.style?.align ?? 'center') === value} onPress={() => textActions?.style('align', value)} />)}</View>
            <TextStyleSection item={selected} fonts={customFonts} fontReady={fontActions?.has} fontFailed={fontActions?.failed} fontChecking={fontActions?.checking}
                organizationAvailable={fontActions?.available} onChange={(key, value) => textActions?.style(key, value) ?? false} />
            <TypographySection item={selected} onChange={(key, value) => textActions?.typography(key, value) ?? false} />
            <BehindSubjectSection timeline={timeline} item={selected} patch={patchSelected} />
            {selected.style && documentIdentity(selected.style) !== documentIdentity(SERVER_PLAIN_TEXT_STYLE)
                ? <Text style={styles.panelDetail}>{exportRefusal('text.style')}</Text> : null}
        </> : <Text style={styles.body}>{t('editor.selectatextlayeronthetimeline')}</Text>}
        {fontActions?.available ? <>
            <Action label={t('editorFont.manage')} onPress={() => { fontActions.clearProblem(); setFontsOpen(true); }} />
            <CustomFontLibrarySheet visible={fontsOpen} fonts={customFonts} actions={fontActions}
                used={Object.fromEntries(customFonts.map(font => [font.family, timeline.text.filter(item => item.style?.font === font.family).length]))}
                selected={selection?.track === 'text' && selected && 'text' in selected ? selected.style?.font : undefined}
                onUse={selection?.track === 'text' && selected && 'text' in selected ? family => { if (textActions?.style('font', family)) setFontsOpen(false); } : undefined}
                onClose={() => setFontsOpen(false)} />
        </> : null}
        <Text style={styles.panelDetail}>{t('editorText.previewText')}</Text>
    </>;
}
