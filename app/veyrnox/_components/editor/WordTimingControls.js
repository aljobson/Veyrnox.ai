'use client';
import { localeTag } from '../../../../lib/i18n/locales.mjs';

import { useI18n } from '../../../../components/I18nProvider';
import { useState } from 'react';
import { Button } from '../Button';
import { WORD_STYLE,distributeWords } from '../../_lib/editorWords.mjs';
import { NumberControl,SelectControl,ColorControl } from './EditorFields';
export function WordTimingControls({item,onChange}) {
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale), {useGrouping:false, maximumFractionDigits:20}).format(value);
    const [selected,setSelected]=useState(0),words=item.words||[],index=Math.min(selected,Math.max(0,words.length-1)),word=words[index],style={...WORD_STYLE,...item.wordStyle};
    const set=(key,value)=>onChange({words:words.map((w,i)=>i===index?{...w,[key]:value}:w),wordsEstimated:true});
    if(!item.caption)return null;
    return <details><summary className="cursor-pointer text-xs font-bold">{t("app.editor.words.title")}</summary><div className="mt-2 space-y-2">
        <SelectControl label={t("app.editor.words.style")} value={style.mode} options={['none','highlight','karaoke','word']} onChange={v=>onChange({wordStyle:{...style,mode:v}})} /><ColorControl label={t("app.editor.words.color")} value={style.color} onChange={v=>onChange({wordStyle:{...style,color:v}})} />
        <Button size="sm" onClick={()=>onChange(distributeWords(item))}>{t("app.editor.words.distribute")}</Button>
        <p className="text-xs text-vx-fg-muted">{t("app.editor.words.help")}</p>
        {word && <><label className="block text-xs">{t("app.editor.words.segment")}<select aria-label={t("app.editor.words.segment")} value={index} onChange={e=>setSelected(Number(e.target.value))} className="w-full rounded-lg border border-vx-border bg-vx-base p-2 text-xs">{words.map((w,i)=><option key={i} value={i}>{number(i+1)}. {w.text}</option>)}</select></label>
            <NumberControl label={t("app.editor.words.start")} value={word.start/30} min={-600} max={600} onChange={n=>set('start',Math.round(n*30))} /><NumberControl label={t("app.editor.words.duration")} value={word.len/30} min={1/30} max={600} onChange={n=>set('len',Math.round(n*30))} />
            <p className="text-xs text-vx-fg-muted">{item.wordsEstimated?t("app.editor.words.estimated"):t("app.editor.words.imported")}</p><Button size="sm" variant="ghost" onClick={()=>onChange({words:[]})}>{t("app.editor.words.clear")}</Button>
        </>}
    </div></details>;
}
