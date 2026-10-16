'use client';
import { STUDIO_FOLDERS } from '../../_lib/filmStudio';
import { FilmField, FilmSelect } from './FilmFields';
import { normalizeFilmStack } from '../../_lib/authenticatedMedia';

export function FilmSetup({ film, update, models }) {
  const stack = (key, value) => update({ ...film, stack: normalizeFilmStack(film.stack, key, value, models) });
  const access = [['Studio','Veyrnox Studio'], ['External','External app or workflow']];
  const selectedVideo = models.find(model => model.id === film.stack.video);
  const frameFormats = film.stack.videoAccess === 'Studio' && selectedVideo?.aspects?.length
    ? selectedVideo.aspects : ['16:9','9:16','1:1'];
  const clipLengths = film.stack.videoAccess === 'Studio'
    ? (selectedVideo?.durations || [10]).filter(seconds => seconds >= 10 && seconds <= 15)
    : Array.from({length:6},(_,i)=>i+10);
  return <div className="space-y-5">
    <p className="text-sm text-vx-fg-muted">Choose the tools you already use. Every later stage uses these choices.</p>
    {['image','video'].map(kind => <section key={kind} className="space-y-4 rounded-xl border border-vx-border p-4">
      <FilmSelect label={`${kind === 'image' ? 'Image' : 'Video'} workflow`} value={film.stack[`${kind}Access`]} onChange={v => stack(`${kind}Access`,v)} options={access}/>
      {film.stack[`${kind}Access`] === 'Studio' ? <FilmSelect label={`${kind === 'image' ? 'Image' : 'Video'} model`} value={film.stack[kind]} onChange={v=>stack(kind,v)} options={[
        ['', 'Choose your model'], ...models.filter(m=>m.kind===kind&&m.takesPrompt!==false&&!m.gated&&!m.isEdit&&!m.takesTopic&&!m.takesPlan&&(kind!=='video'||m.durations?.some(n=>n>=10&&n<=15))).map(m=>[m.id,m.name]),
      ]}/> : <FilmField label={`${kind === 'image' ? 'Image' : 'Video'} model`} value={film.stack[kind]} onChange={v=>stack(kind,v)} hint="Record its name. Keep credentials in your existing tool."/>}
    </section>)}
    <div className="grid gap-4 sm:grid-cols-2"><FilmSelect label="Clip length" value={film.stack.seconds} onChange={v=>stack('seconds',v)} options={(clipLengths.length ? clipLengths : [10]).map(seconds=>[String(seconds),`${seconds} seconds`])}/>
      <FilmSelect label="Frame format" value={film.stack.aspect} onChange={v=>stack('aspect',v)} options={frameFormats.map(a=>[a,a])}/></div>
    <p className="text-sm text-vx-fg-muted">Lock assets first. Keep one passport per asset and state variant. Change one prompt line per attempt. Version and log every result.</p>
  </div>;
}
export function FilmInit({ film, update }) {
  return <div className="space-y-5"><FilmField label="Project name" value={film.name} onChange={name=>update({...film,name})} maxLength={100}/>
    <FilmSelect label="Target film length" value={String(film.targetSeconds)} onChange={value=>update({...film,targetSeconds:Number(value)})} options={[30,60,90,120].map(seconds=>[String(seconds),`${seconds} seconds`])}/>
    <p className="text-sm text-vx-fg-muted">The studio export contains your project documents and this folder structure.</p>
    <pre className="overflow-auto rounded-xl bg-vx-panel p-4 text-xs leading-6">{STUDIO_FOLDERS.map(s=>`${s}/`).join('\n')}</pre>
    <ul className="list-disc space-y-2 pl-5 text-sm"><li>Only approved takes in selects reach the edit.</li><li>Raw generation attempts stay in generations for the prompt engineer.</li><li>Reference filenames stay fixed. A new version gets a new file.</li></ul>
  </div>;
}
