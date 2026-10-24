'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppNav } from './NavBar';
import { Button } from './Button';
import { Chip } from './Chip';
import { writeStudioDraft } from '../_lib/landingDraft';
import {
  FACELESS_REEL_FORMATS,
  FACELESS_REEL_PACING,
  FACELESS_REEL_PLATFORMS,
  buildFacelessReelPrompt,
  facelessReelLaunch,
  facelessReelValidation,
} from '../_lib/facelessReel';

const card = 'rounded-2xl border border-vx-border bg-vx-panel';
const field = 'w-full rounded-xl border border-vx-border bg-vx-base px-4 py-3 text-sm text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-hidden';

function ChoiceCards({ label, value, options, onChange }) {
  return (
    <fieldset>
      <legend className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-fg-muted">{label}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <button key={option.id} type="button" aria-pressed={value === option.id} onClick={() => onChange(option.id)} className="rounded-xl border border-vx-border p-3 text-left transition-colors hover:border-vx-accent aria-pressed:border-vx-accent aria-pressed:bg-vx-accent/[0.07]">
            <span className="block text-xs font-black">{option.label}</span>
            {option.description && <span className="mt-1 block text-[10px] leading-4 text-vx-fg-muted">{option.description}</span>}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export default function FacelessReelStudio() {
  const router = useRouter();
  const [topic, setTopic] = useState('');
  const [hook, setHook] = useState('');
  const [format, setFormat] = useState('explainer');
  const [pacing, setPacing] = useState('balanced');
  const [platform, setPlatform] = useState('reels');
  const [duration, setDuration] = useState(5);
  const [sound, setSound] = useState(false);
  const [originality, setOriginality] = useState(false);
  const [faceless, setFaceless] = useState(false);
  const [error, setError] = useState('');

  const values = { topic, hook, format, pacing, platform, duration, sound, originality, faceless };
  const selectedPlatform = FACELESS_REEL_PLATFORMS.find((item) => item.id === platform) || FACELESS_REEL_PLATFORMS[0];
  const selectedFormat = FACELESS_REEL_FORMATS.find((item) => item.id === format) || FACELESS_REEL_FORMATS[0];
  const previewPrompt = topic.trim() ? buildFacelessReelPrompt(values) : '';

  function launch() {
    const issue = facelessReelValidation(values);
    if (issue) {
      setError(issue);
      return;
    }
    const draft = facelessReelLaunch(values);
    if (!writeStudioDraft(window.sessionStorage, draft)) {
      setError('The reel brief could not be handed to Create. Copy the prompt and open Create manually.');
      return;
    }
    router.push('/app/create?model=wan-2.5-kie&recipe=faceless-reel');
  }

  return (
    <div className="min-h-dvh bg-vx-base text-vx-fg">
      <AppNav active="create" />
      <main className="mx-auto max-w-[1320px] px-4 pb-20 pt-8 sm:px-8 sm:pt-12">
        <header className="grid gap-6 border-b border-vx-border pb-8 lg:grid-cols-[1fr_360px] lg:items-end">
          <div>
            <div className="flex flex-wrap gap-2"><Chip tone="accent">Faceless reel</Chip><Chip>Text to video</Chip></div>
            <h1 className="vx-display mt-5 max-w-4xl text-[42px] leading-[0.94] sm:text-[62px]">Build the story. Skip the presenter.</h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-vx-fg-muted sm:text-base">Plan an original short around objects, places, graphics and atmosphere. This creates one 5- or 10-second visual master; voice, captions, sound and publishing stay separate and reviewable.</p>
          </div>
          <div className="rounded-2xl border border-vx-accent/30 bg-vx-accent/[0.06] p-5 text-xs leading-5 text-vx-fg-muted"><strong className="text-vx-fg">Real model contract</strong><br/>Wan 2.5 creates one text-to-video clip at 5 or 10 seconds. A five-second result can continue into the separately priced MMAudio sound pass. Nothing generates or spends here.</div>
        </header>

        <section className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-vx-border bg-vx-border sm:grid-cols-3" aria-label="Faceless reel workflow">
          {[['01', 'Shape the idea'], ['02', 'Set rhythm & frame'], ['03', 'Review quote & render']].map(([number, label]) => <div key={number} className="bg-vx-panel p-4"><span className="font-vx-mono text-[10px] font-bold text-vx-accent">{number}</span><span className="ml-3 text-xs font-black">{label}</span></div>)}
        </section>

        <div className="mt-8 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
            <section className={`${card} p-4 sm:p-5`}>
              <div className="flex items-start justify-between gap-4"><div><p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">STEP 1</p><h2 className="mt-1 text-lg font-black">Story brief</h2></div><span className="font-vx-mono text-[11px] text-vx-fg-faint">{topic.length}/800</span></div>
              <textarea aria-label="Faceless reel visual brief" value={topic} maxLength={800} rows={6} onChange={(event) => { setTopic(event.target.value); setError(''); }} placeholder="What should the viewer understand, feel or notice? Describe the objects, setting, visual progression and final image…" className={`${field} mt-4 resize-y`} />
              <label className="mt-4 block text-xs font-bold text-vx-fg-body">Optional editorial hook<input aria-label="Faceless reel caption hook" value={hook} maxLength={160} onChange={(event) => setHook(event.target.value)} placeholder="A short hook to add later as a real caption" className={`${field} mt-2 font-normal`} /></label>
              <p className="mt-2 text-[11px] leading-4 text-vx-fg-faint">The hook guides composition only. The video model is told not to draw the words.</p>
            </section>

            <section className={`${card} p-4 sm:p-5`}>
              <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">STEP 2</p><h2 className="mt-1 text-lg font-black">Visual structure</h2>
              <div className="mt-5"><ChoiceCards label="Format" value={format} options={FACELESS_REEL_FORMATS} onChange={setFormat} /></div>
              <div className="mt-6"><ChoiceCards label="Pacing" value={pacing} options={FACELESS_REEL_PACING} onChange={setPacing} /></div>
            </section>

            <section className={`${card} space-y-6 p-4 sm:p-5`}>
              <div><p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">STEP 3</p><h2 className="mt-1 text-lg font-black">Delivery</h2></div>
              <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Faceless reel platform">
                {FACELESS_REEL_PLATFORMS.map((item) => <button key={item.id} type="button" aria-pressed={platform === item.id} onClick={() => setPlatform(item.id)} className="rounded-xl border border-vx-border p-3 text-left transition-colors hover:border-vx-accent aria-pressed:border-vx-accent aria-pressed:bg-vx-accent/[0.07]"><span className="block text-xs font-black">{item.label}</span><span className="mt-1 block font-vx-mono text-[10px] text-vx-fg-muted">{item.aspect}</span></button>)}
              </div>
              <fieldset><legend className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-fg-muted">Duration</legend><div className="mt-2 flex gap-2">{[5, 10].map((seconds) => <button key={seconds} type="button" aria-pressed={duration === seconds} onClick={() => { setDuration(seconds); if (seconds > 8) setSound(false); }} className="min-h-10 rounded-full border border-vx-border px-5 text-xs font-black hover:border-vx-accent aria-pressed:border-vx-accent aria-pressed:bg-vx-accent/[0.08]">{seconds}s</button>)}</div></fieldset>
              <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-vx-border bg-vx-base p-4"><span><strong className="block text-sm">Plan generated sound</strong><span className="mt-1 block text-[11px] leading-4 text-vx-fg-muted">After a 5-second reel succeeds, continue into the verified one-credit video-to-audio tool. Narration and music remain separate.</span></span><input aria-label="Plan generated sound" type="checkbox" checked={sound} disabled={duration > 8} onChange={(event) => setSound(event.target.checked)} className="mt-1 h-4 w-4 accent-[var(--vx-accent)] disabled:opacity-40"/></label>
            </section>
          </div>

          <aside className="space-y-5 xl:sticky xl:top-24">
            <section className={`${card} overflow-hidden`}>
              <div className="border-b border-vx-border p-5"><p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-fg-muted">REEL PLAN</p><h2 className="mt-1 text-lg font-black">{selectedFormat.label}</h2></div>
              <div className="relative aspect-[9/12] bg-[radial-gradient(circle_at_30%_20%,rgba(62,166,143,0.22),transparent_36%),linear-gradient(145deg,rgba(255,255,255,0.04),transparent)] p-6"><div className="flex h-full flex-col justify-between rounded-2xl border border-vx-border/70 bg-vx-base/60 p-5"><span className="font-vx-mono text-[10px] text-vx-accent">FACELESS · {duration}S</span><p className="text-xl font-black leading-tight">{hook.trim() || topic.trim() || 'Your original visual hook appears here.'}</p><div className="space-y-2"><div className="h-1.5 w-full rounded-full bg-vx-accent/30"/><div className="h-1.5 w-2/3 rounded-full bg-vx-accent/15"/><p className="pt-2 font-vx-mono text-[9px] text-vx-fg-faint">CAPTION-SAFE LOWER THIRD</p></div></div></div>
              <div className="grid grid-cols-3 gap-px bg-vx-border text-center"><div className="bg-vx-panel p-3"><span className="block font-vx-mono text-[9px] text-vx-fg-faint">FRAME</span><strong className="mt-1 block text-xs">{selectedPlatform.aspect}</strong></div><div className="bg-vx-panel p-3"><span className="block font-vx-mono text-[9px] text-vx-fg-faint">OUTPUT</span><strong className="mt-1 block text-xs">{duration}s</strong></div><div className="bg-vx-panel p-3"><span className="block font-vx-mono text-[9px] text-vx-fg-faint">AUDIO</span><strong className="mt-1 block text-xs">{sound ? 'Sound pass' : 'Separate'}</strong></div></div>
            </section>

            <section className={`${card} p-5`}>
              <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">ORIGINALITY & SAFETY</p>
              <div className="mt-4 space-y-3"><label className="flex cursor-pointer gap-3 rounded-xl border border-vx-border bg-vx-base p-3 text-xs leading-5"><input type="checkbox" checked={originality} onChange={(event) => setOriginality(event.target.checked)} className="mt-1 h-4 w-4 accent-[var(--vx-accent)]"/><span>The concept, claims and creative direction are original or cleared for this use.</span></label><label className="flex cursor-pointer gap-3 rounded-xl border border-vx-border bg-vx-base p-3 text-xs leading-5"><input type="checkbox" checked={faceless} onChange={(event) => setFaceless(event.target.checked)} className="mt-1 h-4 w-4 accent-[var(--vx-accent)]"/><span>I will not use this flow to imitate a person, creator account, brand interface or private identity.</span></label></div>
              {error && <p role="alert" className="mt-4 rounded-xl border border-vx-danger/35 bg-vx-danger/[0.06] px-4 py-3 text-xs leading-5 text-vx-danger">{error}</p>}
              <Button className="mt-5 w-full justify-center" size="lg" onClick={launch}>Open Create with this reel</Button>
              <p className="mt-3 text-center text-[11px] leading-4 text-vx-fg-faint">No credits are spent here. Create shows the current model price before Generate.</p>
            </section>

            <section className={`${card} p-5 text-xs leading-5 text-vx-fg-muted`}><p className="font-bold text-vx-fg">What transfers</p><ul className="mt-3 space-y-2"><li>✓ Original visual brief and structure</li><li>✓ Supported 5s / 10s duration</li><li>✓ 9:16 or 16:9 frame</li><li>✓ Caption-safe and no-face direction</li><li>{sound ? '✓ One-credit generated-sound continuation after a successful 5s reel' : '— Generated sound remains an optional later pass'}</li><li>— Narration, captions, music and publishing stay separate</li></ul>{previewPrompt && <details className="mt-4 border-t border-vx-border pt-3"><summary className="cursor-pointer font-bold text-vx-accent">Review generated prompt</summary><p className="mt-3 text-[11px] leading-5">{previewPrompt}</p></details>}</section>
          </aside>
        </div>
      </main>
    </div>
  );
}
