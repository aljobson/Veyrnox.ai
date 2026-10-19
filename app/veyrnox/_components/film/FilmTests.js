'use client';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { tOr, pluralKey } from '../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { useState } from 'react';
import { assetKey, isLocked, lockAsset, testMatrix, testPrompt } from '../../_lib/filmStudio';
import { FilmField, FilmSelect } from './FilmFields';
import { FilmPromptOutput } from './FilmPromptOutput';

export function FilmTests({film,update,models,live}){
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale), {useGrouping:false, maximumFractionDigits:20}).format(value);
  const [selected,setSelected]=useState('');const [error,setError]=useState('');
  const asset=film.assets.find(a=>assetKey(a)===selected)||film.assets[0];
  if(!asset)return null;
  const rows=testMatrix(film,asset),locked=isLocked(film,asset);
  const score=rows.filter(r=>asset.tests[r.id]?.verdict==='pass'&&asset.tests[r.id]?.result.trim()).length;
  const edit=(id,patch)=>update({...film,assets:film.assets.map(a=>a===asset?{...a,lock:null,tests:{...a.tests,[id]:{result:'',verdict:'pending',...a.tests[id],...patch}}}:a)});
  const lock=()=>{try{update(lockAsset(film,assetKey(asset)));setError('');}catch(e){setError(e.message);}};
  return <div className="space-y-5"><p className="text-sm text-vx-fg-muted">{t("app.film.tests.help")}</p>
    <FilmSelect label={t("app.film.tests.asset")} value={assetKey(asset)} onChange={v=>{setSelected(v);setError('');}} options={film.assets.map(a=>[assetKey(a),`${assetKey(a)} · ${isLocked(film,a)?t("app.film.state.locked"):t("app.publish.composer.status.draft")}`])}/>
    <p role="status" className="text-sm font-semibold">{assetKey(asset)} · {locked?t("app.film.state.Locked"):t("app.film.state.Draft")} · {t(pluralKey(t,locale,"app.film.tests.passed",rows.length),{score:number(score),total:number(rows.length)})}</p>
    {asset.type==='character'&&<p className="text-xs text-vx-fg-muted">{t("app.film.tests.repeat")}</p>}
    <div className="space-y-3">{rows.map((row,i)=><details key={row.id} className="rounded-xl border border-vx-border p-4" open={i===0||undefined}><summary data-testid={`film-test-toggle-${i+1}`} className="cursor-pointer text-sm font-semibold">{t("app.film.tests.number",{n:number(i+1)})} {row.angle} · {row.size} · {row.shot}{row.pair?t("app.film.tests.beside",{pair:row.pair}):''} · {tOr(t,`app.film.verdict.${asset.tests[row.id]?.verdict}`,asset.tests[row.id]?.verdict && asset.tests[row.id]?.verdict !== 'pending' ? t("app.publish.contacts.unknown") : t("app.publish.composer.status.pending"))}</summary>
      <div className="mt-4 space-y-4"><FilmPromptOutput title={t("app.film.tests.prompt",{n:number(i+1)})} prompt={testPrompt(film,asset,row)} modelId={film.stack.image} access={film.stack.imageAccess} models={models} live={live}/>
        <FilmField label={t("app.film.tests.output",{n:number(i+1)})} value={asset.tests[row.id]?.result||''} onChange={result=>edit(row.id,{result})} disabled={locked} hint={t("app.film.tests.outputHint")}/>
        <FilmSelect label={t("app.film.tests.verdict",{n:number(i+1)})} value={asset.tests[row.id]?.verdict||'pending'} onChange={verdict=>edit(row.id,{verdict})} disabled={locked} options={[['pending',t('social.status.pending')],['pass',t('app.film.verdict.Pass')],['miss',t('app.film.verdict.Miss')]]}/>
      </div></details>)}</div>
    {error&&<p role="alert" className="text-sm text-vx-danger">{error}</p>}
    <button type="button" disabled={locked||score!==rows.length} onClick={lock} className="rounded-full bg-vx-accent px-5 py-2 text-sm font-semibold text-vx-accent-ink disabled:opacity-40">{t("app.film.tests.lock",{asset:assetKey(asset)})}</button>
  </div>;
}
