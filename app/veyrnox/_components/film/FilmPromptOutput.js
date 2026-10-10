'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { writeStudioDraft } from '../../_lib/landingDraft';

export function FilmPromptOutput({ title, prompt, modelId, access, models, live, aspect, duration }) {
  const router=useRouter(); const [notice,setNotice]=useState('');
  const model=models.find(m=>m.id===modelId&&m.takesPrompt!==false&&!m.gated&&!m.isEdit&&!m.takesTopic&&!m.takesPlan);
  const max=model?.promptMax||2000;
  const canOpen=access==='Studio'&&live&&model&&prompt.length<=max&&(!duration||model.durations?.includes(duration));
  const open=()=>{
    if(!canOpen)return;
    if(!writeStudioDraft(window.sessionStorage,{prompt,model:modelId,aspect,durationSeconds:duration})){setNotice('The Studio draft could not be saved. Copy the prompt and paste it in Create.');return;}
    router.push(`/app/create?model=${encodeURIComponent(modelId)}`);
  };
  const copy=async()=>{try{await navigator.clipboard.writeText(prompt);setNotice('Prompt copied.');}catch{setNotice('Copy the prompt from the text box.');}};
  return <section className="space-y-3 rounded-xl border border-vx-border p-4"><h3 className="text-sm font-bold">{title}</h3>
    <textarea aria-label={title} readOnly value={prompt} rows={8} className="w-full rounded-lg border border-vx-field bg-vx-panel p-3 font-vx-mono text-xs focus:border-vx-accent focus:outline-none"/>
    <div className="flex flex-wrap gap-3"><button type="button" onClick={copy} className="text-sm font-semibold text-vx-accent">Copy prompt</button>
      {canOpen&&<button type="button" onClick={open} className="rounded-full bg-vx-accent px-4 py-2 text-sm font-semibold text-vx-accent-ink">Open in Studio</button>}</div>
    {access==='Studio'&&!canOpen&&<p className="text-xs text-vx-fg-muted">{prompt.length>max?`This full prompt exceeds the model's ${max}-character limit. Use an external workflow that accepts it; canonical descriptors stay complete.`:duration&&model&&!model.durations?.includes(duration)?'This model does not support the shot’s clip length. Choose a compatible workflow in setup.':'The live catalog must confirm this model before the prompt can open in Studio.'}</p>}
    {canOpen&&<p className="text-xs text-vx-fg-muted">Choose required reference media in Create. The Studio shows the exact price before you press Generate.</p>}
    {notice&&<p role="status" className="text-xs">{notice}</p>}
  </section>;
}
