
import { t } from '../../../lib/i18n';

import { Action, LabeledInput, PanelHeading, EmptyPanel } from '../EditorControls';

import { TranscriptRow } from './EditorRows';
import type { ToolPanelProps } from './types';
export function CaptionsPanel({ timeline, selection, selected, addCaption, updateSelectedText, selectClip, setFrame }: Pick<ToolPanelProps, 'timeline' | 'selection' | 'selected' | 'addCaption' |
    'updateSelectedText' | 'selectClip' | 'setFrame'>) {
    return <>
        <PanelHeading title={t('editor.captions')} detail={timeline.text.length ? t('editor.textcues', { value1: timeline.text.length }) : t('editor.nocues')} />
        <Action label={t('editor.addcaptionatplayhead')} onPress={addCaption} />
        {selection?.track === 'text' && selected && 'text' in selected ? <LabeledInput label={t('editor.words')} value={selected.text} onChangeText={updateSelectedText} /> : null}
        {timeline.text.map((item) => <TranscriptRow key={item.id} item={item} fps={timeline.fps} selected={selection?.track === 'text' && selection.id === item.id} onPress={() => {
            selectClip({ track: 'text', id: item.id }); setFrame(item.start); }} />)}
    </>;
}
export function TranscriptPanel({ timeline, selection, selectClip, setFrame }: Pick<ToolPanelProps, 'timeline' | 'selection' | 'selectClip' | 'setFrame'>) {
    return <>
        <PanelHeading title={t('editor.transcript')} detail={t('editor.cues', { value1: timeline.text.length })} />
        {timeline.text.length ? [...timeline.text].sort((a, b) => a.start - b.start).map((item) => <TranscriptRow key={item.id} item={item} fps={timeline.fps} selected={selection?.track
            === 'text' && selection.id === item.id} onPress={() => { selectClip({ track: 'text', id: item.id }); setFrame(item.start); }} />) : <EmptyPanel
            title={t('editor.notranscriptyet')} body={t('editor.captionandtextcuesbecomeatime')} />}
    </>;
}
