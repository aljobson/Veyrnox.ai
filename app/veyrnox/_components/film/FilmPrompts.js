'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { useState } from 'react';
import { ACCEPTANCE_CHECKS, PROMPT_DETAILS, buildShotPrompt, logFilmAttempt, nextPromptVersion, promptContext } from '../../_lib/filmStudio';
import { FilmField, FilmSelect } from './FilmFields';
import { FilmPromptOutput } from './FilmPromptOutput';
import { FilmMaster } from './FilmMaster';

export function FilmPrompts({film,update,models,live}){
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
  const [selected,setSelected]=useState(''),[details,setDetails]=useState({}),[revision,setRevision]=useState(null);
  const [result,setResult]=useState(''),[changed,setChanged]=useState(() => t('app.film.prompts.first')),[verdict,setVerdict]=useState('rejected'),[checks,setChecks]=useState([]),[error,setError]=useState('');
  const shot=film.shots.find(s=>s.id===selected)||film.shots[0];
  const versions=film.prompts.filter(p=>p.shot===shot.id),last=versions.at(-1);
  const current=last&&last.context===promptContext(film,shot);
  const logged=last&&film.attempts.some(a=>a.shot===shot.id&&a.version===last.version);
  const failed=film.attempts.filter(a=>a.shot===shot.id&&a.verdict==='rejected'&&versions.find(p=>p.version===a.version)?.context===promptContext(film,shot)).length;
  const build=()=>{try{
    const content=buildShotPrompt(film,shot,details),prompt=nextPromptVersion(film,shot,content);
    update({...film,prompts:[...film.prompts,prompt]});setError('');setRevision(null);setChanged(t("app.film.prompts.first"));
  }catch(e){setError(e.message);}};
  const revise=()=>{try{
    const prompt=nextPromptVersion(film,shot,revision);
    update({...film,prompts:[...film.prompts,prompt]});setRevision(null);setError('');setChanged(t("app.film.prompts.revised"));setResult('');setChecks([]);
  }catch(e){setError(e.message);}};
  const log=()=>{try{
    update(logFilmAttempt(film,last,{result,changed,verdict,checks}));setResult('');setError('');setChecks([]);
  }catch(e){setError(e.message);}};
  return <div className="space-y-5"><p className="text-sm text-vx-fg-muted">{t("app.film.prompts.help")}</p>
    <FilmSelect label={t("app.film.prompts.shot")} value={shot.id} onChange={v=>{setSelected(v);setDetails({});setRevision(null);setResult('');setError('');setChecks([]);}} options={film.shots.map(s=>[s.id,s.id])}/>
    {!current&&<><div className="space-y-4">{PROMPT_DETAILS.map(([key,label])=><FilmField key={key} label={label} multiline value={details[key]||''} onChange={value=>setDetails({...details,[key]:value})}/>)}</div>
      <button type="button" onClick={build} className="rounded-full bg-vx-accent px-5 py-2 text-sm font-semibold text-vx-accent-ink">{t("app.film.prompts.build")}</button></>}
    {current&&<>
      <p role="status" className="text-sm font-semibold">{t('app.film.prompts.version', {shot: shot.id, version: number(last.version), status: logged?t("app.film.prompts.logged"):t("app.film.prompts.ready")})}</p>
      <FilmPromptOutput title={t("app.film.prompts.output")} prompt={last.content} modelId={film.stack.video} access={logged?'External':film.stack.videoAccess} models={models} live={live} aspect={film.stack.aspect} duration={Number(shot.seconds)}/>
      {!logged&&<section className="space-y-4 rounded-xl border border-vx-border p-4"><h3 className="font-bold">{t("app.film.prompts.log")}</h3>
        <FilmField label={t("app.film.prompts.changed")} value={changed} onChange={setChanged}/>
        <FilmField label={t("label.Generation result")} value={result} onChange={setResult} hint={t('app.film.prompts.resultHint')}/>
        <FilmSelect label={t("app.film.prompts.verdict")} value={verdict} onChange={setVerdict} options={[['rejected', t('app.film.prompts.verdict.rejected')],['accepted', t('app.film.prompts.verdict.accepted')]]}/>
        {verdict==='accepted'&&<fieldset className="space-y-2"><legend className="mb-3 text-sm font-semibold">{t("app.film.prompts.checks")}</legend>{ACCEPTANCE_CHECKS.map(c=><label key={c} className="flex gap-3 text-sm"><input type="checkbox" checked={checks.includes(c)} onChange={e=>setChecks(e.target.checked?[...checks,c]:checks.filter(v=>v!==c))}/>{c}</label>)}</fieldset>}
        <button type="button" onClick={log} disabled={!result.trim()||!changed.trim()} className="rounded-full bg-vx-accent px-4 py-2 text-sm font-semibold text-vx-accent-ink disabled:opacity-40">{t("app.film.prompts.record")}</button>
      </section>}
      {logged&&failed<15&&<section className="space-y-4"><h3 className="font-bold">{t("app.film.prompts.revise")}</h3><FilmField label={t("app.film.prompts.next")} multiline rows={14} value={revision??last.content} onChange={setRevision}/>
        <button type="button" disabled={revision===null} onClick={revise} className="rounded-lg border border-vx-accent px-4 py-2 text-sm text-vx-accent disabled:opacity-40">{t("app.film.prompts.save")}</button></section>}
      {failed>=15&&<p role="alert" className="text-sm">{t("app.film.prompts.missed")}</p>}
    </>}
    {error&&<p role="alert" className="text-sm text-vx-danger">{error}</p>}
    {!!film.attempts.length&&<section><h3 className="font-bold">{t("app.film.prompts.recorded")}</h3><ul className="mt-3 space-y-2 text-sm">{film.attempts.filter(a=>a.shot===shot.id).map(a=><li key={a.version} className="rounded-lg border border-vx-border p-3">v{number(a.version)} · {tOr(t, `app.film.prompts.verdict.${a.verdict}`, a.verdict)} · {a.changed}<span className="mt-1 block text-xs text-vx-fg-muted">{a.result}</span><FilmMaster key={`${promptContext(film,shot)}:${a.result}:${a.verdict}`} film={film} attempt={a}/></li>)}</ul></section>}
  </div>;
}
