import { useState } from 'react';
import { Text, View } from 'react-native';
import { WORD_STYLE } from '../../../../../../app/veyrnox/_lib/editorWords.mjs';
import { t, formatNumber } from '../../../lib/i18n';
import type { TextClip } from '../../../lib/nativeEditorModel';
import { Action, Choice, Stepper } from '../EditorControls';
import { styles } from '../fullEditorStyles';
import { SegmentedChoice } from './SegmentedChoice';
import { ColourField } from './ColourField';
import type { CaptionActions } from './useCaptionActions';
export function WordTimingSection({ item, fps, actions }: { item: TextClip; fps: number; actions: CaptionActions }) {
    const [index, setIndex] = useState(0), word = item.words?.[index], style = { ...WORD_STYLE, ...item.wordStyle };
    return <>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{t('editorCaptionTools.wordTiming')}</Text>
        <SegmentedChoice label={t('editorCaptionTools.mode')} value={style.mode} options={[
            { value: 'none', label: t('editorCaptionTools.none') }, { value: 'highlight', label: t('editorCaptionTools.highlight') },
            { value: 'karaoke', label: t('editorCaptionTools.karaoke') }, { value: 'word', label: t('editorCaptionTools.word') },
        ]} onChange={mode => actions.wordStyle({ mode: mode as NonNullable<TextClip['wordStyle']>['mode'] })} />
        <ColourField label={t('editorCaptionTools.colour')} value={style.color} swatches={['#ffe66d', '#ffffff', '#00ffff']}
            onChange={color => actions.wordStyle({ color })} />
        <Action label={t('editorCaptionTools.spread')} onPress={actions.distribute} />
        <View style={styles.choices}>{item.words?.map((w, i) => <Choice key={i} label={t('editorCaptionTools.wordLabel', { n: i + 1, text: w.text })}
            selected={i === index} onPress={() => setIndex(i)} />)}</View>
        {word ? <>
            <Stepper label={t('editorCaptionTools.start')} value={word.start} min={-Infinity} max={Infinity} step={1}
                suffix={` · ${t('editorTools.secondsValue', { value: formatNumber(word.start / fps, 2) })}`} onChange={value => actions.word(index, 'start', value)} />
            <Stepper label={t('editorCaptionTools.length')} value={word.len} min={1} max={Infinity} step={1}
                suffix={` · ${t('editorTools.secondsValue', { value: formatNumber(word.len / fps, 2) })}`} onChange={value => actions.word(index, 'len', value)} />
            <Text style={styles.panelDetail}>{item.wordsEstimated === false ? t('editorCaptionTools.imported') : t('editorCaptionTools.estimated')}</Text>
            <Action label={t('editorCaptionTools.clearTiming')} onPress={actions.clear} />
        </> : null}
    </>;
}
