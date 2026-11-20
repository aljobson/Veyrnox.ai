import { CaptionFileSection } from './CaptionFileSection';
import { WordTimingSection } from './WordTimingSection';
import { TranscriptSection } from './TranscriptSection';
import { LyricSection } from './LyricSection';

import { t } from '../../../lib/i18n';

import { Action, LabeledInput, PanelHeading, EmptyPanel } from '../EditorControls';

import { TranscriptRow } from './EditorRows';
import type { ToolPanelProps } from './types';
export function CaptionsPanel({ timeline, selection, selected, captionActions, addCaption, updateSelectedText, selectClip, setFrame }: Pick<ToolPanelProps, 'timeline' | 'selection' |
    'selected' | 'addCaption' |
    'updateSelectedText' |
    'selectClip' | 'setFrame' | 'captionActions'>) {
    return <>
        <PanelHeading title={t('editor.captions')} detail={timeline.text.length ? t('editor.textcues', { value1: timeline.text.length }) : t('editor.nocues')} />
        <Action label={t('editor.addcaptionatplayhead')} onPress={addCaption} />
        {captionActions ? <CaptionFileSection timeline={timeline} selected={selected && 'text' in selected ? selected : undefined} actions={captionActions} /> : null}
        {selection?.track === 'text' && selected && 'text' in selected ? <LabeledInput label={t('editor.words')} value={selected.text}
            onChangeText={selected.caption && captionActions ? captionActions.text : updateSelectedText} /> : null}
        {captionActions && selected && 'text' in selected && selected.caption ?
            <WordTimingSection key={selected.id} item={selected} fps={timeline.fps} actions={captionActions} /> : null}
        {captionActions ? <LyricSection timeline={timeline} actions={captionActions} /> : null}
        {timeline.text.map((item) => <TranscriptRow key={item.id} item={item} fps={timeline.fps} selected={selection?.track === 'text' && selection.id === item.id} onPress={() => {
            selectClip({ track: 'text', id: item.id }); setFrame(item.start); }} />)}
    </>;
}
export function TranscriptPanel({ timeline, selection, selectClip, setFrame, captionActions }: Pick<ToolPanelProps, 'timeline' | 'selection' |
    'selectClip' | 'setFrame' | 'captionActions'>) {
    return <>
        <PanelHeading title={t('editor.transcript')} detail={t('editor.cues', { value1: timeline.text.length })} />
        {captionActions && timeline.text.some(c => c.caption) ? <TranscriptSection timeline={timeline} actions={captionActions} />
            : !captionActions && timeline.text.length ? [...timeline.text].sort((a, b) => a.start - b.start).map((item) => <TranscriptRow key={item.id} item={item} fps={timeline.fps}
            selected={selection?.track
            === 'text' && selection.id === item.id} onPress={() => { selectClip({ track: 'text', id: item.id }); setFrame(item.start); }} />) : <EmptyPanel
            title={t('editor.notranscriptyet')} body={t('editor.captionandtextcuesbecomeatime')} />}
    </>;
}
