'use client';
import { useI18n } from '../../../components/I18nProvider';
import { tOr } from '../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { generationSlotKind, generationMimeTypes } from '../../../lib/generationSourceSlots.mjs';

// One upload field per media slot the model declares in the catalog
// (capabilities.media): a start image, a video to lip-sync, the speech.
// Types match /api/v1/uploads (lib/uploadSource.js); caps come from the slot.
const SLOTS = {
  image: { labelKey: 'app.create.sources.image.label', hint: 'app.create.sources.image.hint', add: 'app.create.sources.image.add' },
  endImage: { labelKey: 'app.create.sources.endImage.label', hint: 'app.create.sources.image.hint', add: 'app.create.sources.endImage.add' },
  video: { labelKey: 'app.create.sources.video.label', hint: 'app.create.sources.video.hint', add: 'app.create.sources.video.add' },
  audio: { labelKey: 'app.create.sources.audio.label', hint: 'app.create.sources.audio.hint', add: 'app.create.sources.audio.add' },
};

const pill = 'font-vx-mono text-[11px] font-bold rounded-full px-3.5 py-1.5 border border-vx-border text-vx-fg-muted hover:text-vx-fg shrink-0';

/**
 * @param {object} props
 * @param {Record<string,{required:boolean,maxSeconds?:number,maxPixels?:number}>} props.media
 * @param {Record<string,{file:File, previewUrl:string}>} props.sources
 * @param {(slot:string, file:File|null) => void} props.onPick
 * @param {(() => void)|null} props.onDraw  shown for the image slot when set
 * @param {((slot:string) => void)|null} props.onLibrary  "From library" for each known media slot
 */
export function SourcePickers({ media, sources, onPick, onDraw, onLibrary }) {
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
  return Object.entries(media).filter(([slot]) => SLOTS[slot]).map(([slot, spec]) => {
    const ui = SLOTS[slot];
    const kind = generationSlotKind(slot);
    const picked = sources[slot];
    const limits = [spec.maxSeconds && t('app.create.sources.seconds', {count: number(spec.maxSeconds)}), spec.maxPixels && t('app.create.sources.pixels', {count: number(spec.maxPixels / 1e6)})].filter(Boolean);
    return (
      <div key={slot} className="mt-3 flex items-center gap-3 rounded-lg border border-vx-border bg-vx-panel p-3">
        {picked && kind === 'image' ? (
          <img src={picked.previewUrl} alt={slot === 'endImage' ? t("app.create.sources.endAlt") : t("app.create.sources.startAlt")} className="w-16 h-16 rounded-sm object-cover bg-black shrink-0" />
        ) : (
          <div className="w-16 h-16 rounded-sm border border-dashed border-vx-border shrink-0 flex items-center justify-center text-vx-fg-faint" aria-hidden="true">
            {picked ? '✓' : ''}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">
            {(spec.label ? tOr(t, `app.create.sources.label.${spec.label}`, spec.label) : t(ui.labelKey))}{spec.required ? t("app.create.sources.required") : t("app.create.sources.optional")}
          </div>
          <div className="text-xs text-vx-fg-body truncate mt-1">
            {picked ? (picked.file ? picked.file.name : t('app.create.sources.libraryName', {name: picked.label})) : [t(ui.hint), ...limits].join(', ')}
          </div>
        </div>
        {/* A Library image is a presigned R2 URL: the canvas cannot read it back. */}
        {picked?.file && slot === 'image' && onDraw && (
          <button onClick={onDraw} className={pill}>{t("app.create.sources.draw")}</button>
        )}
        {onLibrary && (
          <button data-assistant-control="create.upload" type="button" onClick={() => onLibrary(slot)} className={pill}>{t("app.create.sources.library")}</button>
        )}
        <label className={`${pill} cursor-pointer has-focus-visible:outline-solid has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-vx-accent`}>
          {picked ? t("app.oddlings.replace") : t(ui.add)}
          <input data-testid={`source-upload-${slot}`} type="file" accept={generationMimeTypes(kind).join(',')} className="sr-only"
            onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; onPick(slot, f || null); }} />
        </label>
        {picked && (
          <button onClick={() => onPick(slot, null)} aria-label={tOr(t, `app.create.sources.${slot}.remove`, t('app.publish.smartlink.remove'))}
            className="font-vx-mono text-[11px] text-vx-fg-muted hover:text-vx-fg shrink-0">✕</button>
        )}
      </div>
    );
  });
}
