'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { useEffect, useState } from 'react';
import { Button } from '../Button';
import { NumberControl } from './EditorControls';
import { parseCaptions, insertCaptions, exportCaptions, cutSequenceRange, applyCaptionStyle } from '../../_lib/editorCaptions.mjs';
import { addSequenceText, updateSequenceClip, removeSequenceClip } from '../../_lib/editorSequence.mjs';
import { TEXT_DEFAULTS } from '../../_lib/editorSequenceValidation.mjs';
import { formatTime } from '../../_lib/editorTimeline.mjs';
import { CaptionTranslationControls } from './CaptionTranslationControls';
import { SpeechRecognitionControls } from './SpeechRecognitionControls';
import { LyricAlignmentControls } from './LyricAlignmentControls';
import { useEditorCompletionFlags } from './CompletionFlags';
export function CaptionPanel({ tl, blobs, disabled, frame, apply, onSelect, onSeek, onError, onBusy }) {
  const { t, locale } = useI18n();
    const time = value => locale === 'en' ? formatTime(value) : formatTime(value).replace(/\d+/g, digits => new Intl.NumberFormat(localeTag(locale), {useGrouping:false,minimumIntegerDigits:digits.length}).format(Number(digits)));
    const {localInference}=useEditorCompletionFlags();
    const [download, setDownload] = useState(null);
    useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);
    async function upload(e) {
        const file = e.target.files[0]; e.target.value = ''; if (!file) return;
        if (file.size > 262144) { onError(t("app.editor.transcript.limit")); return; }
        const result = parseCaptions(await file.text(), file.name.split('.').at(-1).toLowerCase());
        if (result.error) { onError(result.error); return; }
        apply(timeline => insertCaptions(timeline, result.cues));
    }
    const items = tl.text.filter(c => c.caption);
    const save = format => setDownload({ url: URL.createObjectURL(new Blob([exportCaptions(tl, format)], { type: 'text/plain' })), name: `captions.${format}` });
    return <section aria-label={t("app.editor.captions.title")} className="space-y-3">
        <p className="text-xs text-vx-fg-muted">{t("app.editor.captions.help")}</p>
        <label className="block cursor-pointer rounded-lg border border-dashed border-vx-border p-3 text-xs">{t("app.editor.captions.importTypes")}<input aria-label={t("app.editor.captions.import")} data-testid="caption-import" type="file" accept=".srt,.vtt,.ass,.lrc,.json" className="sr-only" disabled={disabled} onChange={upload} /></label>
        <p className="text-[10px] text-vx-fg-muted">{t("app.editor.captions.formats")}</p>
        <Button size="sm" disabled={disabled} onClick={() => { const next = apply(timeline => addSequenceText(timeline, { text: t("app.editor.captions.default"), caption: true, start: Math.min(frame, 17910), len: 90 })); if (next) onSelect({ track: 'text', id: `t${next.seq}` }); }}>{t("app.editor.captions.add")}</Button>
        <CaptionTranslationControls tl={tl} disabled={disabled} apply={apply} onError={onError} onBusy={onBusy} />
        {localInference && <SpeechRecognitionControls tl={tl} blobs={blobs} disabled={disabled} apply={apply} onError={onError} onBusy={onBusy} />}
        <LyricAlignmentControls tl={tl} disabled={disabled} apply={apply} />
        {!!items.length && <><div className="flex flex-wrap gap-2"><Button size="sm" disabled={disabled} onClick={() => save('srt')}>{t("app.editor.captions.srt")}</Button><Button size="sm" disabled={disabled} onClick={() => save('vtt')}>{t("app.editor.captions.vtt")}</Button><Button size="sm" disabled={disabled} onClick={() => apply(timeline => applyCaptionStyle(timeline, { ...TEXT_DEFAULTS, color: '#ffe66d', backgroundOpacity: 0.7 }))}>{t("app.editor.captions.style")}</Button></div>{download && <a className="text-xs text-vx-accent underline" href={download.url} download={download.name}>{t("label.Download")}{' '}{download.name}</a>}</>}
        <fieldset disabled={disabled}><ol className="space-y-3">{items.map(c => <li key={c.id} className="space-y-2 rounded-lg border border-vx-border p-2">
            <button type="button" className="text-xs font-bold text-vx-accent" onClick={() => { onSeek(c.start); onSelect({ track: 'text', id: c.id }); }}>{time(c.start)} — {time(c.start + c.len)}</button>
            <textarea aria-label={t("app.editor.captions.label", {id:c.id})} key={`${c.id}:${c.text}`} defaultValue={c.text} maxLength={1000} rows={2} disabled={disabled} className="w-full rounded bg-vx-base p-2 text-xs" onBlur={e => { if (e.target.value.trim() && e.target.value !== c.text) apply(timeline => updateSequenceClip(timeline, 'text', c.id, { text: e.target.value })); }} />
            <NumberControl label={t("app.editor.captions.start", {id:c.id})} value={c.start / 30} min={0} max={600} onChange={n => apply(timeline => updateSequenceClip(timeline, 'text', c.id, { start: Math.round(n * 30) }))} />
            <NumberControl label={t("app.editor.captions.duration", {id:c.id})} value={c.len / 30} min={1 / 30} max={600} onChange={n => apply(timeline => updateSequenceClip(timeline, 'text', c.id, { len: Math.round(n * 30) }))} />
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" disabled={disabled} onClick={() => apply(timeline => removeSequenceClip(timeline, 'text', c.id))}>{t("app.editor.captions.remove")}</Button><Button size="sm" variant="ghost" disabled={disabled} onClick={() => apply(timeline => cutSequenceRange(timeline, c.start, c.start + c.len))}>{t("app.editor.captions.cut")}</Button></div>
        </li>)}</ol></fieldset>
    </section>;
}
