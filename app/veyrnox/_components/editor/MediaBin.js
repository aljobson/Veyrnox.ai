'use client';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { pluralKey } from '../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { formatTime } from '../../_lib/editorTimeline.mjs';

export function MediaBin({ tl, onAdd, onRemove, disabled }) {
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale), {useGrouping:false, maximumFractionDigits:20}).format(value);
    const items = Object.values(tl.media);
    if (!items.length) return null;
    return <section aria-label={t("app.editor.workspace.projectMedia")} className="rounded-2xl border border-vx-border bg-vx-panel p-4">
        <h2 className="mb-3 text-sm font-bold">{t("app.editor.workspace.projectMedia")}{' '}<span className="font-normal text-vx-fg-muted">{t(pluralKey(t,locale,"app.editor.bin.files",items.length),{count:number(items.length)})}</span></h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{items.map(item => <li key={item.id} className="min-w-0 rounded-xl border border-vx-border bg-vx-base p-3">
            <p className="truncate text-sm font-bold" title={item.name}>{item.name}</p>
            <p className="my-1 text-xs text-vx-fg-muted">{item.kind === 'video' ? t("app.library.kind.video") : t("app.library.kind.audio")}{t("app.editor.bin.source",{time:locale === 'en' ? formatTime(item.frames) : formatTime(item.frames).replace(/\d+/g,value=>new Intl.NumberFormat(localeTag(locale),{useGrouping:false,minimumIntegerDigits:value.length}).format(Number(value)))})}</p>
            <button type="button" disabled={disabled} className="text-xs font-bold text-vx-accent disabled:opacity-40" onClick={() => onAdd(item.id)} aria-label={t("app.editor.bin.add",{name:item.name})}>{t("app.editor.media.addTimeline")}</button>
            <button type="button" disabled={disabled} className="ms-3 text-xs text-vx-fg-muted disabled:opacity-40" onClick={() => onRemove(item.id)} aria-label={t("app.editor.bin.remove",{name:item.name})}>{t("app.editor.bin.removeFile")}</button>
        </li>)}</ul>
    </section>;
}
