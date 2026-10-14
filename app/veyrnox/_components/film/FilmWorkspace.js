'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getStoredUserId, onSessionChange } from '../../../lib/authClient';
import { FILM_STAGES, accessibleStage, emptyFilm, filmFromTemplate, stageIssues } from '../../_lib/filmStudio';
import { readFilm, writeFilm } from '../../_lib/filmStudioStorage';
import { useCatalog } from '../../_lib/useCatalog';
import { FilmIssues } from './FilmFields';
import { FilmInit, FilmSetup } from './FilmSetup';
import { FilmBreakdown } from './FilmBreakdown';
import { FilmBoards } from './FilmBoards';
import { FilmPassports } from './FilmPassports';
import { FilmFiles } from './FilmFiles';
import { FilmTests } from './FilmTests';
import { FilmPrompts } from './FilmPrompts';
import { filmStudioStore } from '../../_lib/filmStudioStore';
import { takeFilmStarter } from '../../_lib/filmTemplateDraft';
import { modelIdForName, presetTitle, templateById, templateHref } from '../../_lib/tokens';
import { SHOWCASE_CLIPS } from '../../_lib/showcase';

const storage = () => { try { return window.localStorage; } catch { return null; } };
const serverState={film:emptyFilm(),stage:0,ready:false,userId:null,error:null,saved:false};
const seededFilm = starter => filmFromTemplate(starter, modelIdForName(starter.model) || '');

function SelectedTemplate({ templateId, targetSeconds, pending = false }) {
  const template = templateById(templateId);
  if (!template) return null;
  const clip = SHOWCASE_CLIPS[template.clipKey];
  return <div className={`grid overflow-hidden rounded-xl border ${pending ? 'mt-3 border-vx-border bg-vx-base/60' : 'mb-7 border-vx-accent bg-vx-panel/50'} sm:grid-cols-[9rem_minmax(0,1fr)]`}>
    {clip?.poster ? <img src={clip.poster} alt={`${presetTitle(template.name)} template preview`} className="h-36 w-full object-cover sm:h-full" style={{objectPosition:clip.objectPosition || '50% 50%'}}/> : <div className="h-28 bg-vx-panel"/>}
    <div className="p-4">
      <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">{pending ? 'READY TO START' : 'SELECTED TEMPLATE'}</p>
      <h2 className="mt-1 text-lg font-black">{presetTitle(template.name)}</h2>
      <p className="mt-1 text-xs text-vx-fg-muted">{template.category} · {template.model} · {targetSeconds}-second film</p>
      <p className="mt-2 text-sm text-vx-fg-body">Its prompt, model, frame format and target runtime are linked to this Film Studio project.</p>
      <Link href={templateHref(template)} className="mt-3 inline-block text-sm font-bold text-vx-accent">View template →</Link>
    </div>
  </div>;
}
export function FilmWorkspace() {
  const [state,setState]=useState(serverState);
  const [pendingStarter,setPendingStarter]=useState(null);
  const {film,stage,ready,userId,error,saved}=state;
  useEffect(()=>{
    const sync=()=>setState(filmStudioStore.getState());
    const stop=filmStudioStore.subscribe(sync);sync();return stop;
  },[]);
  const setStage=stage=>filmStudioStore.set({stage});
  const {models,live} = useCatalog();
  useEffect(()=>{
    const load = (force=false) => {
      const id=getStoredUserId(); const loaded=readFilm(storage(),id);
      const starter=takeFilmStarter(window.sessionStorage);
      const blank=!loaded.film.name&&!loaded.film.script&&!loaded.film.shots.length;
      if(starter&&blank){
        loaded.film=seededFilm(starter);
        try { if(id) writeFilm(storage(),id,loaded.film); } catch { /* The seeded project still works in memory. */ }
      } else if(starter) setPendingStarter(starter);
      if(!force&&filmStudioStore.getState().ready&&filmStudioStore.getState().userId===id) {filmStudioStore.set({ready:true});return;}
      filmStudioStore.set({userId:id,film:loaded.film,error:loaded.error,saved:!!id&&!loaded.error,stage:accessibleStage(loaded.film),ready:true});
    };
    load(); return onSessionChange(()=>load(true));
  },[]);
  const update = next => {
    filmStudioStore.set({film:next,saved:false,error:null});
    try { filmStudioStore.set({saved:writeFilm(storage(),userId,next)}); }
    catch { filmStudioStore.set({error:'Changes are not saved. Export your studio before leaving this page.'}); }
  };
  const available=accessibleStage(film), current=Math.min(stage,available);
  const issues=stageIssues(film,current);
  if(!ready) return <p role="status" className="p-8">Loading Film Studio…</p>;
  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
    <header className="mb-8"><p className="font-vx-mono text-xs tracking-widest text-vx-fg-muted">FILM STUDIO</p><h1 className="mt-2 text-3xl font-black">Plan your AI film, shot by shot.</h1>
      <p className="mt-3 max-w-2xl text-sm text-vx-fg-muted">Film Studio helps you keep characters, locations and style consistent. It prepares each shot for generation; it does not make or edit the whole film for you.</p>
      <section aria-labelledby="film-studio-how-to" className="mt-5 max-w-4xl rounded-xl border border-vx-border bg-vx-panel p-4">
        <h2 id="film-studio-how-to" className="text-sm font-bold">How to use it</h2>
        <ol className="mt-3 grid gap-2 text-sm text-vx-fg-muted sm:grid-cols-2">
          <li><span className="font-semibold text-vx-fg">1.</span> Choose your image and video tools.</li>
          <li><span className="font-semibold text-vx-fg">2.</span> Add your story and split it into short shots.</li>
          <li><span className="font-semibold text-vx-fg">3.</span> Add and approve your visual references.</li>
          <li><span className="font-semibold text-vx-fg">4.</span> Describe each character, location and prop.</li>
          <li><span className="font-semibold text-vx-fg">5.</span> Generate test images and lock the ones that match.</li>
          <li><span className="font-semibold text-vx-fg">6.</span> Build the final prompt for each shot.</li>
          <li><span className="font-semibold text-vx-fg">7.</span> Open it in Create, generate the clip and record the result.</li>
        </ol>
      </section>
      <p role="status" className="mt-3 text-xs text-vx-fg-muted">{saved?'Saved in this browser. Export a copy to keep it when you sign out.':userId?'Changes are not saved.':'Sign in to save in this browser. You can work and export without signing in.'}</p>
      <FilmFiles film={film} onImport={next=>{update(next);setStage(accessibleStage(next));}}/>
    </header>
    {error&&<p role="alert" className="mb-5 text-sm text-vx-danger">{error}</p>}
    {film.templateId&&<SelectedTemplate templateId={film.templateId} targetSeconds={film.targetSeconds}/>}
    {pendingStarter&&<div className="mb-5 rounded-xl border border-vx-accent p-4 text-sm"><p className="font-bold">A template is ready for a {pendingStarter.targetSeconds}-second film.</p><p className="mt-1 text-vx-fg-muted">Your current film is still here. Export it first if you want to keep a separate copy.</p><SelectedTemplate templateId={pendingStarter.templateId} targetSeconds={pendingStarter.targetSeconds} pending/><button type="button" className="mt-3 rounded-full bg-vx-accent px-4 py-2 font-bold text-vx-accent-ink" onClick={()=>{update(seededFilm(pendingStarter));setStage(0);setPendingStarter(null);}}>Start a new film from this template</button></div>}
    <div className="grid items-start gap-7 lg:grid-cols-[240px_minmax(0,1fr)]">
      <nav aria-label="Film Studio stages"><ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">{FILM_STAGES.map(([id,title],i)=><li key={id}>
        <button type="button" onClick={()=>setStage(i)} disabled={i>available} aria-current={i===current?'step':undefined} className={`w-full rounded-xl border p-3 text-left text-sm disabled:opacity-40 ${i===current?'border-vx-accent bg-vx-panel':'border-vx-border'}`}>
          <span className="mr-2 font-vx-mono">{i+1}.</span>{title}<span className="mt-1 block text-xs text-vx-fg-muted">{i<available?'Ready':i===available?'In progress':'Complete the earlier stages'}</span>
        </button></li>)}</ol></nav>
      <section aria-label={FILM_STAGES[current][1]} className="min-w-0 rounded-2xl border border-vx-border p-5 sm:p-7">
        <h2 className="mb-5 text-xl font-bold">{current+1}. {FILM_STAGES[current][1]}</h2>
        <Link href={`/app/chat?skill=${['film-setup','film-studio-init','film-breakdown','film-reference-board','film-asset-passport','film-stress-test','film-shot-prompt'][current]}`} className="mb-5 inline-block text-sm font-semibold text-vx-accent">Get help from this stage’s assistant →</Link>
        {current===0&&<FilmSetup film={film} update={update} models={models}/>}
        {current===1&&<FilmInit film={film} update={update}/>}
        {current===2&&<FilmBreakdown film={film} update={update}/>}
        {current===3&&<FilmBoards film={film} update={update}/>}
        {current===4&&<FilmPassports film={film} update={update} models={models} live={live}/>}
        {current===5&&<FilmTests film={film} update={update} models={models} live={live}/>}
        {current===6&&<FilmPrompts film={film} update={update} models={models} live={live}/>}
        <FilmIssues issues={issues}/>
        {current<6&&<button type="button" disabled={issues.length>0} onClick={()=>setStage(current+1)} className="mt-5 rounded-full bg-vx-accent px-5 py-2 text-sm font-semibold text-vx-accent-ink disabled:opacity-40">Continue to {FILM_STAGES[current+1][1].toLowerCase()}</button>}
      </section>
    </div>
  </div>;
}
