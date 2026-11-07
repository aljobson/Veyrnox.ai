'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch, makeIdempotencyKey, notifyBalanceChanged, GatewayError } from './gateway';
import { pushJobHistory } from './jobHistory';
import { useStudioJobs } from './useStudioJobs';
import { useFreeAllowance } from './useFreeAllowance';
import { freeLeftFor } from './freeAllowance';
import { allocationSnapshot } from './imageBatch';
import { cachedSources, fileIdentity, keepUpload, submitTemplate, templateInputs, templateRun, templateRunDead } from './templateGenerate';
import { TEMPLATE_PROMPT_MAX } from './templateDraft';
import { mediaGenerationSources } from './chatMedia';
import { uploadSourceFile } from './uploadSourceFile';

// The template page's Generate (ADR-0120 amendment 1): Create's submit for one item with nothing attached. The run keeps
// its idempotency key across a retry of the same request, the quote caps the charge, a price change asks to confirm,
// and any change to the request drops the continuation. With a photo it is the one start image, uploaded once, sent with
// the rights tick Create records on the job.
export function useTemplateGenerate({ preset, model, prompt, aspect, aspectOptions, durationSeconds, unitCost, photo = null, needsPhoto = false, preparing = false, templateClip = null }) {
  const [balance, setBalance] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [batchView, setBatchView] = useState(null);
  const onUnreachable = useCallback(() => setError({ code: 'poll_unreachable' }), []);
  const { jobs, generating, startJobs, clearJobs } = useStudioJobs({ onUnreachable });
  const freeMap = useFreeAllowance();
  const continuation = useRef(null);
  const inFlight = useRef(false);
  const uploaded = useRef({});
  const photoToken = fileIdentity(photo);
  const identity = JSON.stringify([model?.id, templateClip ? null : prompt, aspect, durationSeconds, preset.id, photoToken, templateClip?.id]);
  const activeBatch = batchView?.identity === identity ? batchView : null;
  const quote = activeBatch?.quote ?? allocationSnapshot(activeBatch ?? { accepted: [null], unknown: new Set() }, activeBatch?.unit ?? unitCost, model ? freeLeftFor(freeMap, model.id) : 0);
  const payable = quote.payable ?? quote.total;
  const promptBlocked = !templateClip && (!prompt.trim() || prompt.length > TEMPLATE_PROMPT_MAX);
  // While a replacement photo is being prepared the page keeps this mounted (a running job stays on screen) but cannot submit.
  const photoBlocked = preparing || (needsPhoto && !photo);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try { const b = await gatewayFetch('/balance'); if (live) setBalance(b.balance); }
      catch (e) { if (!(e instanceof GatewayError && e.status === 401) && live) setBalance(null); }
    };
    load();
    window.addEventListener('focus', load);
    window.addEventListener('veyrnox:balance-changed', load);
    return () => { live = false; window.removeEventListener('focus', load); window.removeEventListener('veyrnox:balance-changed', load); };
  }, []);

  // Changing any input drops the quote and the continuation, even if it is changed back.
  useEffect(() => {
    if (!continuation.current || continuation.current.identity === identity) return;
    continuation.current = null;
    setBatchView(null);
    setError(null);
  }, [identity]);

  async function generate() {
    if (inFlight.current || sending || generating || !model || balance == null || payable > balance || promptBlocked || photoBlocked) return;
    inFlight.current = true;
    setError(null);
    setSending(true);
    const run = templateRun(continuation.current, identity, unitCost, makeIdempotencyKey);
    continuation.current = run;
    const presentation = {
      model_name: model.name,
      duration_seconds: model.kind === 'video' ? durationSeconds : undefined,
      ...(aspectOptions.length ? { aspect_ratio: aspect } : {}),
    };
    const inputs = templateClip ? { duration_seconds: 5 } : templateInputs(preset, model, { prompt, aspect, durationSeconds, aspectOptions, withPhoto: Boolean(photo) });
    let result;
    try {
      result = await submitTemplate({ run, quote, model, preset, inputs, templateClip, makeKey: makeIdempotencyKey, deps: {
        gatewayFetch,
        sources: photo ? () => cachedSources(uploaded.current, JSON.stringify([model.id, photoToken]), () => mediaGenerationSources(model, { image: { file: photo } }, uploadSourceFile)) : null,
        freeAllowance: async () => { const r = await gatewayFetch('/free-allowance'); return r?.enabled ? r.left : {}; },
        onJob: (submitted, credits) => {
          startJobs({ job_id: submitted.job_id, state: 'queued', credits, model_id: model.id, ...presentation });
          pushJobHistory({ job_id: submitted.job_id, model_id: model.id, credits, prompt: prompt.slice(0, 60), name: prompt.slice(0, 40) });
          if (submitted.balance_after != null) setBalance(submitted.balance_after);
        },
      } });
    } finally {
      inFlight.current = false;
    }
    if (!keepUpload(result.error)) uploaded.current = {};
    if (run.accepted.some(Boolean)) notifyBalanceChanged();
    if (result.error) {
      setError(result.error);
      if (templateRunDead(run, result.error)) continuation.current = null;
    } else continuation.current = null;
    setBatchView(continuation.current ? { ...continuation.current } : null);
    setSending(false);
  }

  const confirming = Boolean(activeBatch?.confirm);
  return {
    jobs, generating, sending, error, quote, confirming, balance, promptBlocked, photoBlocked,
    canGenerate: !!model && !promptBlocked && !photoBlocked && !sending && !generating && balance != null && payable <= balance,
    generate, clear: () => { clearJobs(); setError(null); },
  };
}
