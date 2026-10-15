'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { onSessionChange } from '../../lib/authClient';
import { gatewayFetch } from '../_lib/gateway';
import { readOddlingLibrary } from '../_lib/oddlingStudio';
import { beginJourney, getJourney, initialiseJourney, publishJourneyView, subscribeJourney, updateJourney } from '../_lib/veyJourneyStore';
import { journeyStep, PREPARE_VIDEO } from '../../../lib/veyJourney';
import { REVEAL_SAVED_ODDLING } from '../../../lib/savedOddlingHelp';

const EMPTY = { task: null, view: {} };
const pill = 'rounded-full border border-vx-border px-3 py-2 text-xs font-semibold hover:border-vx-accent disabled:opacity-40';

export default function VeyTaskGuide({ visible, pathname, onPoint, onStop, onActiveChange, onAsk }) {
  const { task, view } = useSyncExternalStore(subscribeJourney, getJourney, () => EMPTY);
  const [choosing, setChoosing] = useState(false);
  const [chatting, setChatting] = useState(false);
  const [library, setLibrary] = useState([]);
  const [recovered, setRecovered] = useState(null);
  const [recoveryError, setRecoveryError] = useState('');
  const [side, setSide] = useState('right');
  const router = useRouter();
  useEffect(() => { initialiseJourney(); return onSessionChange(() => { initialiseJourney(); setChoosing(false); setChatting(false); setRecovered(null); }); }, []);
  useEffect(() => { onActiveChange((!!task || choosing) && !chatting); }, [task, choosing, chatting, onActiveChange]);
  const jobId = task?.phase === 'video' ? task.videoJob : task?.imageJob;
  const liveJob = view.jobs?.find((job) => job.job_id === jobId);
  useEffect(() => {
    if (!jobId || liveJob?.state === 'succeeded' || liveJob?.state === 'failed') return;
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        const job = await gatewayFetch(`/jobs/${encodeURIComponent(jobId)}`);
        if (cancelled) return;
        setRecovered({ job_id: jobId, state: job.state }); setRecoveryError('');
        if (job.state === 'queued' || job.state === 'running') timer = setTimeout(poll, 5000);
      } catch { if (!cancelled) setRecoveryError('The job could not be checked. Open Library or reopen Vey to try again; nothing has been resubmitted.'); }
    };
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [jobId, liveJob?.state, visible]);
  const effectiveView = { ...view, route: pathname, jobs: recovered?.job_id === jobId ? [...(view.jobs || []).filter((j) => j.job_id !== jobId), recovered] : view.jobs };
  // The workspace's fresh state wins over a previous recovery read.
  if (liveJob && ['succeeded', 'failed'].includes(liveJob.state)) effectiveView.jobs = view.jobs;
  const step = journeyStep(task, effectiveView);
  useEffect(() => {
    if (visible && !chatting && step?.target && !['recover', 'waiting'].includes(step.key)) onPoint(step.target, { align: 'start' });
  }, [visible, chatting, step?.key, step?.target, onPoint]);
  useEffect(() => {
    if (!visible || step?.key !== 'load' || pathname !== '/app/oddlings') return;
    const reveal = () => window.dispatchEvent(new CustomEvent(REVEAL_SAVED_ODDLING, { detail: { id: task.passportId } }));
    reveal(); const timer = setTimeout(() => { reveal(); onPoint('oddlings.saved', { align: 'start' }); }, 400);
    return () => clearTimeout(timer);
  }, [visible, step?.key, pathname, task?.passportId, onPoint]);
  if (!visible) return null;
  if (task && chatting) return <button type="button" className="fixed bottom-4 right-4 z-[62] rounded-full border border-vx-accent bg-vx-panel px-4 py-3 text-xs font-bold text-vx-accent shadow-xl" onClick={() => setChatting(false)}>Resume {task.phase} walkthrough</button>;
  if (!task && !choosing) return <button type="button" onClick={() => { setLibrary(readOddlingLibrary(localStorage)); setChatting(false); setChoosing(true); }}
    className="fixed right-4 top-24 z-[62] rounded-xl border border-vx-accent/40 bg-vx-panel px-4 py-3 text-sm font-bold text-vx-accent shadow-xl">Saved Oddling → image → video</button>;
  const prepare = () => {
    if (pathname !== '/app/create') { router.push('/app/create'); return; }
    window.dispatchEvent(new Event(PREPARE_VIDEO));
  };
  return <section aria-label="Vey task walkthrough" data-step={step?.key || 'choose'} className={`fixed ${side === 'right' ? 'right-3' : 'left-3'} bottom-4 z-[62] max-h-[calc(50dvh)] w-[min(330px,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-vx-accent/40 bg-vx-panel p-4 shadow-2xl`}>
    <div className="flex items-center justify-between gap-2"><p className="text-xs font-bold text-vx-accent">{task ? `Vey · ${task.phase === 'image' ? 'Image' : 'Video'} task` : 'Choose your starting point'}</p>
      <button type="button" className="text-xs text-vx-fg-muted" onClick={() => setSide(side === 'right' ? 'left' : 'right')}>Move guide</button></div>
    {choosing && !task ? <>
      <p className="my-3 text-sm text-vx-fg-body">Saved passports stay on this browser. Choose the exact version, or continue with an image already in your Library.</p>
      {library.length === 0 && <p className="text-sm text-vx-fg-muted">No saved passports on this browser. Save one in Oddling Studio first.</p>}
      <div className="my-3 flex flex-col gap-2">{library.map((item) => <button key={item.id} type="button" className={`${pill} text-left`} onClick={() => {
        beginJourney(item.id); setChoosing(false); router.push('/app/oddlings');
      }}>{item.name} · {new Date(item.savedAt).toLocaleString()}</button>)}</div>
      <button type="button" className={pill} onClick={() => { beginJourney(); setChoosing(false); router.push('/app/create'); }}>Start with an existing image</button>
      <button type="button" className={pill} onClick={() => { setChoosing(false); onStop(); }}>Cancel</button>
    </> : <>
      <h3 className="mt-2 text-base font-bold">{step.title}</h3>
      <p role="status" className="mt-2 text-sm leading-6 text-vx-fg-body">{step.message}</p>
      {jobId && <p className="mt-2 break-all font-vx-mono text-[10px] text-vx-fg-muted">Tracked job: {jobId}{task.phase === 'image' ? ' · first image if generating a batch' : ''}</p>}
      {(recoveryError || view.prepareError) && <p role="alert" className="mt-2 text-sm text-vx-danger">{recoveryError || view.prepareError}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={pill} onClick={() => onPoint(step.target, { align: 'start' })}>Show this step</button>
        {step.review && <button type="button" className={pill} onClick={() => updateJourney({ reviewed: { ...task.reviewed, [step.key]: step.stamp } })}>Reviewed · next</button>}
        {step.adopt && <button type="button" className={pill} onClick={() => updateJourney({ imageId: view.sourceId, reviewed: {} })}>Use this selected Library image</button>}
        {step.prepare && <button type="button" disabled={view.preparing} className={pill} onClick={prepare}>{view.preparing ? 'Preparing…' : 'Prepare video from this image'}</button>}
        {step.retry && <button type="button" className={pill} onClick={() => updateJourney({ [task.phase === 'video' ? 'videoJob' : 'imageJob']: null, reviewed: {} })}>Review a new attempt</button>}
        <button type="button" className={pill} onClick={() => { setChatting(true); onAsk('What is the next step in my current task?'); }}>Ask about this step</button>
        <button type="button" className={pill} onClick={() => { updateJourney(null); setChoosing(false); setChatting(false); publishJourneyView({ handedOff: false }); onStop(); }}>End walkthrough</button>
      </div>
      <p className="mt-3 text-[11px] text-vx-fg-muted">You confirm rights and press Generate. Closing Vey pauses the guide, not a submitted job.</p>
    </>}
  </section>;
}
