'use client';
import { useI18n } from '../../../components/I18nProvider';
import { tOr, pluralKey } from '../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { useEffect, useRef, useState } from 'react';
import { generationSlotKind, sourceList, publicSlotMax } from '../../../lib/generationSourceSlots.mjs';
import { pickerAccept } from '../../../lib/uploadInputTypes.mjs';
import { prepareUpload, needsConversion, UploadConvertError } from '../_lib/uploadConvert.mjs';

// One upload field per media slot the model declares in the catalog
// (capabilities.media): a start image, a video to lip-sync, the speech.
// Types match /api/v1/uploads (lib/uploadSource.js); caps come from the slot.
const SLOTS = {
  image: { labelKey: 'app.create.sources.image.label', hint: 'app.create.sources.image.hint', add: 'app.create.sources.image.add' },
  endImage: { labelKey: 'app.create.sources.endImage.label', hint: 'app.create.sources.image.hint', add: 'app.create.sources.endImage.add' },
  video: { labelKey: 'app.create.sources.video.label', hint: 'app.create.sources.video.hint', add: 'app.create.sources.video.add' },
  audio: { labelKey: 'app.create.sources.audio.label', hint: 'app.create.sources.audio.hint', add: 'app.create.sources.audio.add' },
};

const pill = 'font-vx-mono text-[11px] font-bold rounded-full px-3.5 py-1.5 border border-vx-border text-vx-fg-muted hover:text-vx-fg shrink-0 disabled:opacity-50 has-disabled:opacity-50';

/**
 * @param {object} props
 * @param {Record<string,{required:boolean,maxSeconds?:number,maxPixels?:number}>} props.media
 * @param {Record<string,{file:File, previewUrl:string}>} props.sources
 * @param {(slot:string, file:File|null) => void} props.onPick
 * @param {(() => void)|null} props.onDraw  shown for the image slot when set
 * @param {((slot:string) => void)|null} props.onLibrary  "From library" for each known media slot
 * @param {(busy:boolean) => void} [props.onConvertingChange]  true while any slot is converting; the caller must not generate then
 * @param {string} [props.resetKey]  changes when the model or account changes: every conversion still running is dropped
 * @param {{current:number}} [props.epochRef]  the caller bumps it at the moment the model or account changes; a conversion started under an older value never lands
 * @param {boolean} [props.locked]  another conversion (the paperclip) is running: every source control waits
 */
export function SourcePickers({ media, sources, onPick, onDraw, onLibrary, onReorder, onConvertingChange, resetKey = '', epochRef, locked = false }) {
  const { t, locale } = useI18n();
  // HEIC, AVIF, GIF, MOV and WebM are converted here before they reach onPick.
  // Each pick or removal bumps the slot's token, so a conversion that finishes
  // after the user picked again, removed the file or the slot went away is dropped.
  const [converting, setConverting] = useState({});
  const [convertError, setConvertError] = useState({});
  const tokens = useRef({});
  const latestMedia = useRef(media);
  useEffect(() => { latestMedia.current = media; });
  const busy = Object.values(converting).some(Boolean);
  // While any file converts, nothing else may change the sources: a slow conversion would otherwise overwrite the newer choice.
  const hold = busy || locked;
  useEffect(() => { onConvertingChange?.(busy); }, [busy, onConvertingChange]);
  useEffect(() => () => { onConvertingChange?.(false); }, [onConvertingChange]);
  const nextToken = slot => (tokens.current[slot] = (tokens.current[slot] || 0) + 1);
  // A new model, a new account or leaving the page drops every conversion in flight.
  const mediaKey = Object.keys(media || {}).sort().join(',');
  useEffect(() => {
    const live = tokens.current;
    for (const slot of Object.keys(live)) live[slot] += 1;
    setConverting({});
    setConvertError({});
    return () => { for (const slot of Object.keys(live)) live[slot] += 1; };
  }, [resetKey, mediaKey]);
  async function pickFile(slot, file, index) {
    const token = nextToken(slot);
    const epoch = epochRef?.current;
    setConvertError(previous => ({ ...previous, [slot]: '' }));
    if (needsConversion(file)) setConverting(previous => ({ ...previous, [slot]: true }));
    try {
      const ready = await prepareUpload(file);
      if (tokens.current[slot] !== token || epochRef?.current !== epoch || !latestMedia.current?.[slot]) return;
      if (index === undefined) onPick(slot, ready); else onPick(slot, ready, null, index);
    } catch (error) {
      if (tokens.current[slot] !== token) return;
      const code = error instanceof UploadConvertError ? error.code : 'image_unreadable';
      setConvertError(previous => ({ ...previous, [slot]: t(`app.create.convert.${code}`) }));
    } finally {
      if (tokens.current[slot] === token) setConverting(previous => ({ ...previous, [slot]: false }));
    }
  }
  // A removal also cancels a conversion still running for that slot.
  function removeFile(slot, index) {
    nextToken(slot);
    setConverting(previous => ({ ...previous, [slot]: false }));
    if (index === undefined) onPick(slot, null); else onPick(slot, null, null, index);
  }
  const status = slot => converting[slot]
    ? <p role="status" className="basis-full text-xs text-vx-fg-muted">{t('app.create.convert.working')}</p>
    : convertError[slot] ? <p role="alert" className="basis-full text-xs text-vx-danger">{convertError[slot]}</p> : null;
  const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
  return Object.entries(media).filter(([slot]) => SLOTS[slot]).map(([slot, spec]) => {
    const ui = SLOTS[slot], kind = generationSlotKind(slot), files = sourceList(sources[slot]), max = publicSlotMax(spec);
    const limits = [spec.maxSeconds && t('app.create.sources.seconds', {count: number(spec.maxSeconds)}), spec.maxPixels && t('app.create.sources.pixels', {count: number(spec.maxPixels / 1e6)})].filter(Boolean);
    if (max === 1 && files.length <= 1 && !files[0]?.needsUpload) {
      const picked = files[0];
    return (
      <div key={slot} className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-vx-border bg-vx-panel p-3">
        {picked && kind === 'image' && picked.previewUrl ? (
          <img src={picked.previewUrl} alt={slot === 'endImage' ? t("app.create.sources.endAlt") : t("app.create.sources.startAlt")} className="w-16 h-16 rounded-sm object-cover bg-black shrink-0" />
        ) : (
          <div className="w-16 h-16 rounded-sm border border-dashed border-vx-border shrink-0 flex items-center justify-center text-vx-fg-faint" aria-hidden="true">
            {picked ? '✓' : ''}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">
            {(spec.label ? tOr(t, `label.${spec.label}`, spec.label) : t(ui.labelKey))}{spec.required ? t("app.create.sources.required") : t("app.create.sources.optional")}
          </div>
          <div className="text-xs text-vx-fg-body truncate mt-1">
            {picked ? (picked.file ? picked.file.name : picked.sourceKey ? picked.label : t('app.create.sources.libraryName', {name: tOr(t, `app.helpers.message.${picked.labelCode}`, picked.label)})) : [t(ui.hint), ...limits].join(', ')}
          </div>
        </div>
        {/* A Library image is a presigned R2 URL: the canvas cannot read it back. */}
        {picked?.file && slot === 'image' && onDraw && (
          <button onClick={onDraw} disabled={hold} className={pill}>{t("app.create.sources.draw")}</button>
        )}
        {onLibrary && (
          <button data-assistant-control="create.upload" type="button" onClick={() => onLibrary(slot)} disabled={hold} className={pill}>{t("app.create.sources.library")}</button>
        )}
        <label className={`${pill} cursor-pointer has-focus-visible:outline-solid has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-vx-accent`}>
          {picked ? t("app.oddlings.replace") : t(ui.add)}
          <input data-testid={`source-upload-${slot}`} type="file" accept={pickerAccept(kind)} disabled={hold} className="sr-only"
            onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) pickFile(slot, f); }} />
        </label>
        {picked && (
          <button onClick={() => removeFile(slot)} aria-label={tOr(t, `app.create.sources.${slot}.remove`, t('app.publish.smartlink.remove'))}
            className="font-vx-mono text-[11px] text-vx-fg-muted hover:text-vx-fg shrink-0">✕</button>
        )}
        {status(slot)}
      </div>
    );
    }
    return <div key={slot} className="mt-3 space-y-3 rounded-lg border border-vx-border bg-vx-panel p-3">
      <div className="font-vx-mono text-[10px] text-vx-fg-muted">{spec.label ? tOr(t, `label.${spec.label}`, spec.label) : t(ui.labelKey)}{spec.required ? t('app.create.sources.required') : t('app.create.sources.optional')}</div>
      {max > 1 && <p className="text-xs text-vx-fg-muted">{t(pluralKey(t, locale, 'app.create.sources.maxFiles', max), { count: number(max) })} · {[t(ui.hint), ...limits].join(', ')}</p>}
      {files.length > max && <p role="alert">{t(pluralKey(t, locale, 'app.create.sources.overLimit', max), { count: number(max) })}</p>}
      {files.map((picked, index) => <div key={index} className="flex items-center gap-3">
        {kind === 'image' && picked.previewUrl && <img src={picked.previewUrl} alt={t(slot === 'endImage' ? 'app.create.sources.endAlt' : 'app.create.sources.startAlt')} className="w-16 h-16 rounded-sm object-cover" />}
        <span className="min-w-0 flex-1 truncate text-xs">{picked.file?.name || picked.label || t('app.create.sources.image.label')}</span>
        {picked.needsUpload && <label className={pill}>{t('app.create.reattach')}<input type="file" className="sr-only" accept={pickerAccept(kind)} disabled={hold} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) pickFile(slot, file, index); }} /></label>}
        {picked.file && slot === 'image' && index === 0 && onDraw && <button type="button" onClick={onDraw} disabled={hold} className={pill}>{t('app.create.sources.draw')}</button>}
        {onReorder && index > 0 && <button type="button" className={pill} disabled={hold} onClick={() => onReorder(slot, index, index - 1)} aria-label={t('app.create.sources.moveEarlier')}>↑</button>}
        {onReorder && index < files.length - 1 && <button type="button" className={pill} disabled={hold} onClick={() => onReorder(slot, index, index + 1)} aria-label={t('app.create.sources.moveLater')}>↓</button>}
        <button type="button" onClick={() => removeFile(slot, index)} aria-label={tOr(t, `app.create.sources.${slot}.remove`, t('app.publish.smartlink.remove'))}>✕</button>
      </div>)}
      {(files.length < max || max === 1) && <div className="flex gap-3">
        {onLibrary && <button data-assistant-control="create.upload" type="button" onClick={() => onLibrary(slot)} disabled={hold} className={pill}>{t('app.create.sources.library')}</button>}
        <label className={`${pill} cursor-pointer`}>
          {files.length && max === 1 ? t('app.oddlings.replace') : t(ui.add)}
          <input data-testid={`source-upload-${slot}`} type="file" accept={pickerAccept(kind)} disabled={hold} className="sr-only"
            onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) pickFile(slot, file); }} />
        </label>
      </div>}
      {status(slot)}
    </div>;
  });
}
