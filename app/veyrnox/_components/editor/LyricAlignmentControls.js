'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { pluralKey } from '../../../../lib/i18n/translate.mjs';
import { useState } from 'react';
import { Button } from '../Button';
import { alignLyricCaptions, lyricSourceCaptions } from '../../_lib/editorLyrics.mjs';
export function LyricAlignmentControls({tl, disabled, apply}) {
  const { t, locale } = useI18n();
    const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
    const [lyrics,setLyrics] = useState(''), [source,setSource] = useState('all');
    const sources = lyricSourceCaptions(tl), sourceValid = source === 'all' || sources.some(c => c.id === source);
    return <details><summary className="cursor-pointer text-xs font-bold">{t("app.editor.lyrics.title")}</summary><div className="mt-2 space-y-2">
        <p className="text-xs text-vx-fg-muted">{t("app.editor.lyrics.help")}</p>
        <label className="block text-xs">{t("app.editor.lyrics.source")}<select aria-label={t("app.editor.lyrics.source")} value={source} disabled={disabled} onChange={e=>setSource(e.target.value)} className="w-full rounded border border-vx-border bg-vx-base p-2"><option value="all">{t("app.editor.lyrics.all")}</option>{!sourceValid && <option value={source}>{t("app.editor.lyrics.changed")}</option>}{sources.map(c=><option key={c.id} value={c.id}>{c.text.slice(0,80)}</option>)}</select></label>
        <label className="block text-xs">{t("app.editor.lyrics.supplied")}<textarea aria-label={t("app.editor.lyrics.supplied")} value={lyrics} maxLength={16000} rows={5} disabled={disabled} onChange={e=>setLyrics(e.target.value)} className="w-full rounded border border-vx-border bg-vx-base p-2" /></label>
        <p role="status" aria-label={t("app.editor.lyrics.status")} className="text-xs text-vx-fg-muted">{sources.length ? t(pluralKey(t, locale, 'app.editor.lyrics.available', sources.length), {count:number(sources.length)}) : t("app.editor.lyrics.empty")}</p>
        <Button size="sm" disabled={disabled || !sources.length || !sourceValid || !lyrics.trim()} onClick={()=>apply(timeline=>alignLyricCaptions(timeline,lyrics,source))}>{t("app.editor.lyrics.align")}</Button>
    </div></details>;
}
