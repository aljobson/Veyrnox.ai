'use client';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getStoredUserId, onSessionChange } from '../../../lib/authClient';
import { FILM_STAGES, accessibleStage, emptyFilm, filmFromTemplate, stageIssues } from '../../_lib/filmStudio';
import { writeWorkspace } from '../../_lib/filmStudioStorage';
import { useCatalog } from '../../_lib/useCatalog';
import { FilmIssues } from './FilmFields';
import { FilmInit, FilmSetup } from './FilmSetup';
import { FilmBreakdown } from './FilmBreakdown';
import { FilmBoards } from './FilmBoards';
import { FilmPassports } from './FilmPassports';
import { FilmFiles } from './FilmFiles';
import { FilmCloud } from './FilmCloud';
import { sessionLoadPatch, replaceWorkspaceFilm, pendingVisible, persistenceFailurePatch } from '../../_lib/filmStudioCloud';
import { FilmTests } from './FilmTests';
import { FilmPrompts } from './FilmPrompts';
import { filmStudioStore } from '../../_lib/filmStudioStore';
import { takeFilmStarter } from '../../_lib/filmTemplateDraft';
import { modelIdForName, presetTitle, templateById, templateHref } from '../../_lib/tokens';
import { SHOWCASE_CLIPS } from '../../_lib/showcase';

const storage = () => { try { return window.localStorage; } catch { return null; } };
const serverState={film:emptyFilm(),stage:0,ready:false,userId:null,error:null,saved:false,cloud:null,generation:0,pending:null};
const seededFilm = starter => filmFromTemplate(starter, modelIdForName(starter.model) || '');

function SelectedTemplate({ templateId, targetSeconds, pending = false }) {
  const { t, locale } = useI18n();
  const number = n => locale === 'en' ? String(n) : Number(n).toLocaleString(localeTag(locale));
  const template = templateById(templateId);
  if (!template) return null;
  const clip = SHOWCASE_CLIPS[template.clipKey];
  return <div className={`grid overflow-hidden rounded-xl border ${pending ? 'mt-3 border-vx-border bg-vx-base/60' : 'mb-7 border-vx-accent bg-vx-panel/50'} sm:grid-cols-[9rem_minmax(0,1fr)]`}>
    {clip?.poster ? <img src={clip.poster} alt={t('app.film.workspace.preview', { name: presetTitle(template.name) })} className="h-36 w-full object-cover sm:h-full" style={{objectPosition:clip.objectPosition || '50% 50%'}}/> : <div className="h-28 bg-vx-panel"/>}
    <div className="p-4">
      <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">{pending ? t("app.film.workspace.readyToStart") : t("app.film.workspace.selected")}</p>
      <h2 className="mt-1 text-lg font-black">{presetTitle(template.name)}</h2>
      <p className="mt-1 text-xs text-vx-fg-muted">{template.category} · {template.model} · {t('app.film.workspace.duration', { count: number(targetSeconds) })}</p>
      <p className="mt-2 text-sm text-vx-fg-body">{t("app.film.workspace.linked")}</p>
      <Link href={templateHref(template)} className="mt-3 inline-block text-sm font-bold text-vx-accent">{t("app.film.workspace.view")}</Link>
    </div>
  </div>;
}
export function FilmWorkspace({cloud=false}) {
  const { t, locale } = useI18n();
  const number = n => locale === 'en' ? String(n) : Number(n).toLocaleString(localeTag(locale));
  const [state,setState]=useState(serverState);
  const {film,stage,ready,userId,error,saved,generation}=state;
  const pendingStarter=pendingVisible(state)?state.pending.starter:null;
  useEffect(()=>{
    const sync=()=>setState(filmStudioStore.getState());
    const stop=filmStudioStore.subscribe(sync);sync();return stop;
  },[]);
  const setStage=stage=>filmStudioStore.set({stage});
  const {models,live} = useCatalog();
  const persist = useCallback(({linkOnly=false}={}) => {
    const current=filmStudioStore.getState();
    try {
      const saved=writeWorkspace(storage(),current.userId,current.film,cloud?current.cloud:null);
      if(!linkOnly) filmStudioStore.set({saved,error:null});
      return saved;
    }
    catch { filmStudioStore.set({...persistenceFailurePatch(),error:t("app.film.workspace.saveFailed")}); return false; }
  },[cloud,t]);
  const replaceFilm = useCallback((next,link=null) => {
    filmStudioStore.set(replaceWorkspaceFilm(filmStudioStore.getState(),next,link));
    persist();
  },[persist]);
  useEffect(()=>{
    const load = (force=false) => {
      const id=getStoredUserId(); const prev=filmStudioStore.getState();
      if(cloud&&force&&prev.ready&&prev.userId===id) return;
      const patch=sessionLoadPatch(storage(),id,prev,cloud);
      const starter=takeFilmStarter(window.sessionStorage);
      if(!force&&prev.ready&&prev.userId===id) {
        if(starter) {
          const blank=!prev.film.name&&!prev.film.script&&!prev.film.shots.length;
          if(blank) replaceFilm(seededFilm(starter),null);
          else filmStudioStore.set({pending:{userId:id,generation:prev.generation,starter}});
        }
        return;
      }
      filmStudioStore.set(patch);
      const loaded=filmStudioStore.getState();
      const blank=!loaded.film.name&&!loaded.film.script&&!loaded.film.shots.length;
      if(starter&&blank) replaceFilm(seededFilm(starter),null);
      else if(starter) filmStudioStore.set({pending:{userId:id,generation:loaded.generation,starter}});
    };
    load(); return onSessionChange(()=>load(true));
  },[cloud,replaceFilm]);
  const update = next => {
    filmStudioStore.set({film:next,saved:false,error:null});
    persist();
  };
  const available=accessibleStage(film), current=Math.min(stage,available);
  const issues=stageIssues(film,current);
  if(!ready) return <p role="status" className="p-8">{t("app.film.workspace.loading")}</p>;
  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
    <header className="mb-8"><p className="font-vx-mono text-xs tracking-widest text-vx-fg-muted">{t('label.Film Studio').toLocaleUpperCase(localeTag(locale))}</p><h1 className="mt-2 text-3xl font-black">{t("app.film.workspace.title")}</h1>
      <p className="mt-3 max-w-2xl text-sm text-vx-fg-muted">{t("app.film.workspace.intro")}</p>
      <section aria-labelledby="film-studio-how-to" className="mt-5 max-w-4xl rounded-xl border border-vx-border bg-vx-panel p-4">
        <h2 id="film-studio-how-to" className="text-sm font-bold">{t("app.film.workspace.how")}</h2>
        <ol className="mt-3 grid gap-2 text-sm text-vx-fg-muted sm:grid-cols-2">
          <li><span className="font-semibold text-vx-fg">{number(1)}.</span>{' '}{t("app.film.workspace.step1")}</li>
          <li><span className="font-semibold text-vx-fg">{number(2)}.</span>{' '}{t("app.film.workspace.step2")}</li>
          <li><span className="font-semibold text-vx-fg">{number(3)}.</span>{' '}{t("app.film.workspace.step3")}</li>
          <li><span className="font-semibold text-vx-fg">{number(4)}.</span>{' '}{t("app.film.workspace.step4")}</li>
          <li><span className="font-semibold text-vx-fg">{number(5)}.</span>{' '}{t("app.film.workspace.step5")}</li>
          <li><span className="font-semibold text-vx-fg">{number(6)}.</span>{' '}{t("app.film.workspace.step6")}</li>
          <li><span className="font-semibold text-vx-fg">{number(7)}.</span>{' '}{t("app.film.workspace.step7")}</li>
        </ol>
      </section>
      <p role="status" className="mt-3 text-xs text-vx-fg-muted">{saved?t("app.film.workspace.saved"):userId?t("app.film.workspace.unsaved"):t("app.film.workspace.signIn")}</p>
      {cloud&&userId&&<FilmCloud key={userId} state={state} replaceFilm={replaceFilm} persist={persist}/>}
      <FilmFiles key={generation} film={film} onImport={next=>replaceFilm(next,null)}/>
    </header>
    {error&&<p role="alert" className="mb-5 text-sm text-vx-danger">{error}</p>}
    {film.templateId&&<SelectedTemplate templateId={film.templateId} targetSeconds={film.targetSeconds}/>}
    {pendingStarter&&<div className="mb-5 rounded-xl border border-vx-accent p-4 text-sm"><p className="font-bold">{t('app.film.workspace.pending', { count: number(pendingStarter.targetSeconds) })}</p><p className="mt-1 text-vx-fg-muted">{t("app.film.workspace.keepCopy")}</p><SelectedTemplate templateId={pendingStarter.templateId} targetSeconds={pendingStarter.targetSeconds} pending/><button type="button" className="mt-3 rounded-full bg-vx-accent px-4 py-2 font-bold text-vx-accent-ink" onClick={()=>{replaceFilm(seededFilm(pendingStarter),null);setStage(0);}}>{t("app.film.workspace.start")}</button></div>}
    <div className="grid items-start gap-7 lg:grid-cols-[240px_minmax(0,1fr)]">
      <nav data-assistant-target="film.stages" aria-label={t("label.Film Studio stages")}><ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">{FILM_STAGES.map(([id,title],i)=><li key={id}>
        <button type="button" onClick={()=>setStage(i)} disabled={i>available} aria-current={i===current?'step':undefined} className={`w-full rounded-xl border p-3 text-start text-sm disabled:opacity-40 ${i===current?'border-vx-accent bg-vx-panel':'border-vx-border'}`}>
          <span className="me-2 font-vx-mono">{number(i+1)}.</span>{tOr(t, `app.film.workspace.stage.${id}`, title)}<span className="mt-1 block text-xs text-vx-fg-muted">{i<available?t("app.film.workspace.ready"):i===available?t("app.film.workspace.progress"):t("app.film.workspace.earlier")}</span>
        </button></li>)}</ol></nav>
      <section key={generation} aria-label={tOr(t, `app.film.workspace.stage.${FILM_STAGES[current][0]}`, FILM_STAGES[current][1])} className="min-w-0 rounded-2xl border border-vx-border p-5 sm:p-7">
        <h2 className="mb-5 text-xl font-bold">{number(current+1)}. {tOr(t, `app.film.workspace.stage.${FILM_STAGES[current][0]}`, FILM_STAGES[current][1])}</h2>
        <Link href={`/app/chat?skill=${['film-setup','film-studio-init','film-breakdown','film-reference-board','film-asset-passport','film-stress-test','film-shot-prompt'][current]}`} className="mb-5 inline-block text-sm font-semibold text-vx-accent">{t("app.film.workspace.help")}</Link>
        {current===0&&<FilmSetup film={film} update={update} models={models}/>}
        {current===1&&<FilmInit film={film} update={update}/>}
        {current===2&&<FilmBreakdown film={film} update={update}/>}
        {current===3&&<FilmBoards film={film} update={update}/>}
        {current===4&&<FilmPassports film={film} update={update} models={models} live={live}/>}
        {current===5&&<FilmTests film={film} update={update} models={models} live={live}/>}
        {current===6&&<FilmPrompts film={film} update={update} models={models} live={live}/>}
        <FilmIssues issues={issues}/>
        {current<6&&<button type="button" disabled={issues.length>0} onClick={()=>setStage(current+1)} className="mt-5 rounded-full bg-vx-accent px-5 py-2 text-sm font-semibold text-vx-accent-ink disabled:opacity-40">{t('app.film.workspace.continue', { stage: tOr(t, `app.film.workspace.stage.${FILM_STAGES[current+1][0]}`, FILM_STAGES[current+1][1]).toLocaleLowerCase(localeTag(locale)) })}</button>}
      </section>
    </div>
  </div>;
}
