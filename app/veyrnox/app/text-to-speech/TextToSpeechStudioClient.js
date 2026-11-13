'use client';

import { ChipSelect } from '../../_components/ChipSelect';
import { PromptBox } from '../../_components/PromptBox';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getStoredUserId } from '../../../lib/authClient.js';
import { AppNav } from '../../_components/NavBar';
import { Button } from '../../_components/Button';
import { Chip } from '../../_components/Chip';
import { JobAssetPreview } from '../../_components/JobAssetPreview';
import { DownloadAsset } from '../../_components/DownloadAsset';
import { OutputFileDisclosure } from '../../_components/OutputFileDisclosure';
import { SaveToAudioShelfButton } from '../../_components/SaveToAudioShelfButton';
import { TextToSpeechControls } from '../../_components/TextToSpeechControls';
import { VoiceRecipeLibrary } from '../../_components/VoiceRecipeLibrary';
import { ERROR_COPY, failedJobCopy } from '../../_lib/createErrors';
import { gatewayFetch, GatewayError, makeIdempotencyKey, notifyBalanceChanged } from '../../_lib/gateway';
import { pushJobHistory } from '../../_lib/jobHistory';
import { jobStateUi } from '../../_lib/studioStates';
import { useCatalog } from '../../_lib/useCatalog';
import { useStudioJobs } from '../../_lib/useStudioJobs';
import { sendInOrder, submitErrorCode } from '../../_lib/imageBatch';
import {
  DEFAULT_TTS_SETTINGS,
  TTS_EMOTIONS,
  TTS_LANGUAGES,
  TTS_SCRIPT_LIMIT,
  TTS_VOICES,
  ttsGenerationInputs,
} from '../../_lib/textToSpeech';
import {
  MIN_AUDITION_VOICES,
  auditionBatchNote,
  auditionCost,
} from '../../_lib/voiceAuditions';
import { consumeVoiceRecipeHandoff, voiceRecipesMatch } from '../../_lib/voicePalettes';

const MODEL_ID = 'minimax-speech-2.6-hd';
const card = 'rounded-2xl border border-vx-border bg-vx-panel';

function errorFor(error) {
  return error instanceof GatewayError ? { code: error.code || 'gateway_error', retryAfter: error.retryAfter } : { code: 'internal' };
}

export default function TextToSpeechStudio() {
  const { models, live, loading: catalogLoading } = useCatalog();
  const model = models.find((item) => item.id === MODEL_ID) || null;
  const [script, setScript] = useState('');
  const [settings, setSettings] = useState(DEFAULT_TTS_SETTINGS);
  const [balance, setBalance] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [auditionVoices, setAuditionVoices] = useState([]);
  const [reusedRecipe, setReusedRecipe] = useState(null);
  const inFlight = useRef(false);
  const onUnreachable = useCallback(() => setError({ code: 'poll_unreachable' }), [setError]);
  const { jobs, generating, startJobs, addJob, clearJobs } = useStudioJobs({ onUnreachable });
  const job = jobs[0] || null;
  const busy = sending || generating;
  const cleanScript = script.trim();
  const boardActive = auditionVoices.length > 0;
  const boardReady = auditionVoices.length >= MIN_AUDITION_VOICES;
  const totalCredits = boardActive ? auditionCost(model?.credits, auditionVoices) : model?.credits || 0;
  const auditionResults = jobs.some((item) => !!item.voice_id);

  const loadBalance = useCallback(async () => {
    try {
      const result = await gatewayFetch('/balance');
      setBalance(result.balance);
    } catch (next) {
      if (!(next instanceof GatewayError && next.status === 401)) setBalance(null);
    }
  }, [setBalance]);

  useEffect(() => {
    const initialRead = setTimeout(loadBalance, 0);
    window.addEventListener('veyrnox:balance-changed', loadBalance);
    return () => {
      clearTimeout(initialRead);
      window.removeEventListener('veyrnox:balance-changed', loadBalance);
    };
  }, [loadBalance]);

  useEffect(() => {
    const handoff = consumeVoiceRecipeHandoff(window.sessionStorage, getStoredUserId() || '');
    if (!handoff) return undefined;
    const timer = window.setTimeout(() => {
      setSettings(handoff.settings);
      setReusedRecipe({ name: handoff.label, settings: handoff.settings });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit() {
    if (inFlight.current || busy || catalogLoading || !model || !cleanScript || cleanScript.length > TTS_SCRIPT_LIMIT || balance == null || totalCredits > balance || (boardActive && !boardReady)) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    clearJobs();
    const voices = boardReady ? [...auditionVoices] : [settings.voice];
    const keys = voices.map(() => makeIdempotencyKey());
    try {
      const { started, error: failure } = await sendInOrder(voices.length, async (index) => {
        const voiceId = voices[index];
        const voice = TTS_VOICES.find((item) => item.id === voiceId);
        const submitted = await gatewayFetch('/generations', {
          method: 'POST',
          body: JSON.stringify({
            model_id: model.id,
            idempotency_key: keys[index],
            confirmed_credits: model.credits,
            inputs: { prompt: cleanScript, ...ttsGenerationInputs({ ...settings, voice: voiceId }) },
          }),
        });
        const credits = submitted.free_allowance === true ? 0 : model.credits;
        const queued = { job_id: submitted.job_id, state: 'queued', credits, model_id: model.id, voice_id: voices.length > 1 ? voiceId : undefined, voice_recipe: { ...settings, voice: voiceId } };
        (index === 0 ? startJobs : addJob)(queued);
        pushJobHistory({ job_id: submitted.job_id, model_id: model.id, credits, prompt: cleanScript.slice(0, 60), name: voices.length > 1 ? `Audition · ${voice?.label || 'Stock voice'}` : 'Stock voice' });
        if (submitted.balance_after != null) setBalance(submitted.balance_after);
      });
      if (started > 0) notifyBalanceChanged();
      if (failure) {
        const next = errorFor(failure);
        const code = submitErrorCode(next.code);
        setError({ ...next, code, note: auditionBatchNote(started, voices, code === 'outcome_unknown') });
      }
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  function startAgain() {
    if (busy) return;
    clearJobs();
    setError(null);
  }

  const blocked = busy || catalogLoading || !model || !cleanScript || cleanScript.length > TTS_SCRIPT_LIMIT || balance == null || totalCredits > balance || (boardActive && !boardReady);
  const errorCopy = error ? ERROR_COPY[error.code] || 'The speech job did not start. Check Library before trying again.' : '';
  const reusedRecipeMatches = Boolean(reusedRecipe && voiceRecipesMatch(settings, reusedRecipe.settings));

  return (
    <div className="min-h-dvh bg-vx-base text-vx-fg">
      <AppNav balance={balance} active="create" />
      <div className="mx-auto w-full max-w-[1280px] px-4 pb-20 pt-8 sm:px-8 sm:pt-12">
        <header className="border-b border-vx-border pb-8">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-vx-mono text-[10px] font-bold tracking-[0.16em] text-vx-accent">TEXT TO SPEECH STUDIO</p>
            <Chip tone="neutral">{live ? 'Live catalog' : 'Cached catalog'}</Chip>
          </div>
          <h1 className="vx-display mt-3 text-[40px] leading-[0.95] sm:text-[58px]">Give the script a voice.</h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-vx-fg-muted sm:text-base">Write up to {TTS_SCRIPT_LIMIT} characters, choose one of 17 stock voices, tune language and delivery, then approve one exact audio-job price. This studio never clones a real person&apos;s voice.</p>
        </header>

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <section className={`${card} p-4 sm:p-5`} aria-labelledby="tts-script-title">
              <div className="flex items-start justify-between gap-4">
                <div><p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">STEP 1</p><h2 id="tts-script-title" className="mt-1 text-xl font-black">Script</h2></div>
                {cleanScript && <Chip tone="accent">Ready</Chip>}
              </div>
              <label htmlFor="tts-script" className="sr-only">Speech script</label>
              <PromptBox id="tts-script" aria-label="Speech script" value={script} maxLength={TTS_SCRIPT_LIMIT} rows={7} disabled={busy} onChange={(event) => { setScript(event.target.value); setError(null); }} placeholder="Write exactly what the stock voice should say…">
                <ChipSelect aria-label="Speech language" options={TTS_LANGUAGES} value={settings.language} disabled={busy} onChange={(language) => setSettings({ ...settings, language })} formatOption={(language) => (language === 'auto' ? 'Auto language' : language)} />
                <ChipSelect aria-label="Speaking style" options={TTS_EMOTIONS} value={settings.emotion} disabled={busy} onChange={(emotion) => setSettings({ ...settings, emotion })} formatOption={(emotion) => emotion[0].toUpperCase() + emotion.slice(1)} />
              </PromptBox>
              <div className="mt-2 flex justify-between gap-3 text-xs text-vx-fg-muted"><span>Edits are local until you approve Generate.</span><span className="font-vx-mono">{script.length}/{TTS_SCRIPT_LIMIT}</span></div>
            </section>
            <TextToSpeechControls recipeId="stock-voice" script={script} settings={settings} onSettings={setSettings} onScript={setScript} auditionVoices={auditionVoices} onAuditionVoices={setAuditionVoices} />
            <VoiceRecipeLibrary onApply={(recipe, name) => { setSettings(recipe); setReusedRecipe({ name, settings: recipe }); }} />
            {reusedRecipe&&<div role="status" className={`mt-4 rounded-xl border px-4 py-3 text-xs leading-5 ${reusedRecipeMatches?'border-vx-accent/30 bg-vx-accent/[0.06] text-vx-fg-muted':'border-vx-danger/30 bg-vx-danger/[0.05] text-vx-danger'}`}><strong>{reusedRecipeMatches?'Voice Recipe loaded:':'Voice Recipe modified:'}</strong> {reusedRecipe.name}. {reusedRecipeMatches?'Add a fresh script, review every setting and approve the current price when ready. No script or audio was carried here.':'Current controls no longer match this saved recipe.'}{!reusedRecipeMatches&&<button type="button" onClick={()=>setSettings(reusedRecipe.settings)} className="ml-2 font-extrabold underline">Restore recipe</button>}</div>}
          </div>

          <aside className="space-y-5 lg:sticky lg:top-24">
            <section className={`${card} overflow-hidden`}>
              <div className="flex items-center justify-between border-b border-vx-border px-5 py-4">
                <div><p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-fg-muted">RESULT</p><h2 className="mt-1 font-black">{auditionResults ? 'Audition results' : 'Stock-voice audio'}</h2></div>
                {job && !auditionResults && <Chip tone={job.state === 'failed' ? 'danger' : 'accent'}>{jobStateUi(job).label}</Chip>}
              </div>
              <div className="min-h-44 bg-vx-base p-5">
                {auditionResults ? (
                  <div className="space-y-3" aria-label="Audition Board results">
                    {jobs.map((item) => {
                      const voice = TTS_VOICES.find((candidate) => candidate.id === item.voice_id);
                      return (
                        <article key={item.job_id} className="overflow-hidden rounded-xl border border-vx-border bg-vx-panel" aria-label={`${voice?.label || 'Stock voice'} audition`}>
                          <div className="flex items-center justify-between gap-3 border-b border-vx-border px-3 py-2.5"><p className="text-xs font-extrabold">{voice?.label || 'Stock voice'}</p><Chip tone={item.state === 'failed' ? 'danger' : 'accent'}>{jobStateUi(item).label}</Chip></div>
                          <div className="p-3">{item.asset_url ? <JobAssetPreview job={item} /> : <p className="py-5 text-center text-xs text-vx-fg-muted">This provider audition is {jobStateUi(item).label.toLowerCase()}.</p>}</div>
                          {item.state === 'failed' && <p className="border-t border-vx-border px-3 py-2.5 text-xs text-vx-danger">{failedJobCopy(item)}</p>}
                          {item.state === 'succeeded' && item.asset_url && <div className="flex flex-wrap gap-2 border-t border-vx-border px-3 py-2.5"><DownloadAsset row={item} label="Download" className="inline-flex min-h-9 items-center rounded-full bg-vx-accent px-3 text-[11px] font-extrabold text-vx-accent-ink" errorClassName="basis-full text-xs text-vx-danger" /><SaveToAudioShelfButton jobId={item.job_id} name={`Audition · ${voice?.label || 'Stock voice'}`} purpose="character-performance" voiceRecipe={item.voice_recipe} offerSignature/><Link href={`/app/performance?audio=${encodeURIComponent(item.job_id)}`} className="inline-flex min-h-9 items-center text-[11px] font-bold text-vx-accent underline">Use for lip sync</Link></div>}
                        </article>
                      );
                    })}
                  </div>
                ) : job?.asset_url ? <JobAssetPreview job={job} /> : <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-vx-border px-6 text-center text-sm text-vx-fg-muted">{boardActive ? 'Add two or three voices, then approve the clearly priced Audition Board.' : 'The finished audio will be playable here and stored in Library.'}</div>}
              </div>
              {job?.state === 'failed' && <p className="border-t border-vx-border px-5 py-4 text-sm text-vx-danger">{failedJobCopy(job)}</p>}
              {job?.state === 'succeeded' && job?.asset_url && (
                <div className="flex flex-wrap gap-2 border-t border-vx-border px-5 py-4">
                  <DownloadAsset row={job} label="Download audio" className="inline-flex min-h-10 items-center rounded-full bg-vx-accent px-4 text-xs font-extrabold text-vx-accent-ink" errorClassName="basis-full text-xs text-vx-danger" />
                  
                  <SaveToAudioShelfButton jobId={job.job_id} name={`Stock voice · ${TTS_VOICES.find((item) => item.id === (job.voice_recipe?.voice || settings.voice))?.label || 'Speech'}`} purpose="narration-presenter" voiceRecipe={job.voice_recipe} offerSignature className="inline-flex min-h-10 items-center rounded-full border border-vx-border px-4 text-xs font-extrabold disabled:opacity-60"/>
                  <Link href={`/app/performance?audio=${encodeURIComponent(job.job_id)}`} className="inline-flex min-h-10 items-center px-2 text-xs font-bold text-vx-accent underline">Use for lip sync</Link>
                  <button type="button" onClick={startAgain} className="min-h-10 px-2 text-xs font-bold text-vx-fg-muted underline">Adjust and make another</button>
                </div>
              )}
              {auditionResults && !generating && <div className="border-t border-vx-border px-5 py-4"><button type="button" onClick={startAgain} className="min-h-10 text-xs font-bold text-vx-accent underline">Adjust and audition again</button></div>}
              <OutputFileDisclosure className="m-5" />
            </section>

            <section className={`${card} p-5`}>
              <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-fg-muted">MODEL</p>
              <div className="mt-3 flex items-start justify-between gap-4"><div><p className="text-sm font-black">{model?.name || 'Model unavailable'}</p><p className="mt-1 text-xs leading-5 text-vx-fg-muted">17 stock voices · 17 named languages plus auto-detect · no cloning</p></div>{model && <span className="font-vx-mono text-sm font-bold text-vx-money">{model.credits} cr each</span>}</div>
            </section>

            <section className={`${card} p-5`}>
              <div className="flex items-baseline justify-between"><p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-fg-muted">APPROVE TOTAL</p><p className="font-vx-mono text-[11px] text-vx-fg-muted">balance {balance ?? '—'} cr</p></div>
              <p className="mt-2 font-vx-mono text-[38px] font-black text-vx-money">−{totalCredits} cr</p>
              <p className="mt-2 text-xs leading-5 text-vx-fg-muted">{boardActive ? `${auditionVoices.length} separate provider job${auditionVoices.length === 1 ? '' : 's'} × ${model?.credits ?? 0} credits. Submission stops at the first refusal; every accepted job keeps its own Library result and refund path.` : 'One reusable audio job. Failed jobs follow the automatic refund path; editing and voice selection spend nothing.'}</p>
              <Button className="mt-5 w-full justify-between" cost={totalCredits} disabled={blocked} onClick={submit}>{sending ? (boardActive ? 'Submitting auditions…' : 'Submitting…') : generating ? (auditionResults ? 'Creating auditions…' : 'Creating speech…') : boardActive ? (boardReady ? `Generate ${auditionVoices.length} auditions` : 'Add one more voice') : 'Generate speech'}</Button>
              {!cleanScript && <p className="mt-3 text-xs text-vx-fg-muted">Add a script to continue.</p>}
              {balance != null && totalCredits > balance && <p className="mt-3 text-xs text-vx-danger">You need {totalCredits - balance} more credits. <Link href="/app/credits" className="underline">Add credits</Link>.</p>}
              {error && <p role="alert" className="mt-3 text-xs text-vx-danger">{errorCopy}{error.retryAfter ? ` Retry in ${error.retryAfter}s.` : ''}{error.note ? ` ${error.note}` : ''}</p>}
              <p className="mt-3 text-center font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-faint">PRICE PINNED · STOCK VOICES · REFUND ON FAILURE</p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
