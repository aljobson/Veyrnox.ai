'use client';
import { helperEnglish } from '../../../lib/helperMessages.mjs';

import { useEffect } from 'react';
import { gatewayFetch } from './gateway';
import { animationModel } from './oddlingStudio';
import { getJourney, journeyStamp, publishJourneyView, updateJourney } from './veyJourneyStore';
import { MOTION_DRAFT, PREPARE_VIDEO } from '../../../lib/veyJourney';

export function useCreateJourney({ model, models, catalogLive, prompt, characterOn, character, sources, duration, aspect, n, cost, balance,
  missingSource, missingConsent, missingPrompt, missingVoice, animationMismatch, generating, sending, jobs, error, seed, negative, cinemaOn, cinema,
  setModelId, setPrompt, setSources, setConsent, setDuration, setAnimationPortrait }) {
  const promptStamp = journeyStamp([prompt, characterOn, character]);
  const settingsStamp = journeyStamp([model?.id, duration, aspect, n, seed, negative, cinemaOn, cinema]);
  const costStamp = journeyStamp([promptStamp, settingsStamp, cost, balance, Object.entries(sources).map(([slot, item]) => [slot, item.assetId || item.previewUrl]), missingConsent]);
  const jobStamp = JSON.stringify(jobs.map(({ job_id, state }) => ({ job_id, state })));
  useEffect(() => {
    publishJourneyView({ route: '/app/create', kind: model?.kind, modelId: model?.id, duration, aspect, imageRequired: !!model?.media?.image?.required,
      promptReady: !!prompt?.trim(), promptStamp, settingsStamp, costStamp, characterOn,
      sourceId: sources.image?.assetId || null, sourceAttached: !!sources.image, missingSource, missingConsent, cost, balance,
      canGenerate: !!model && !model.gated && !animationMismatch && !missingSource && !missingConsent && !missingPrompt && !missingVoice && balance != null && cost <= balance && !generating && !sending,
      jobs: JSON.parse(jobStamp), error: error?.code || null });
  }, [model, duration, aspect, prompt, promptStamp, settingsStamp, costStamp, characterOn, sources, missingSource, missingConsent, missingPrompt, missingVoice, animationMismatch, cost, balance, generating, sending, jobStamp, error]);
  useEffect(() => {
    let busy = false;
    let cancelled = false;
    const prepare = async () => {
      const task = getJourney().task;
      const imageId = task?.imageId || task?.imageJob;
      if (!imageId || busy) return;
      busy = true;
      publishJourneyView({ prepareError: '', preparing: true });
      try {
        const next = catalogLive && animationModel(models);
        if (!next) throw new Error('Wait for the live catalog and an available image-to-video model.');
        const job = await gatewayFetch(`/jobs/${encodeURIComponent(imageId)}`);
        if (job.state !== 'succeeded') throw new Error('This image has not finished yet.');
        const asset = await gatewayFetch(`/jobs/${encodeURIComponent(imageId)}/asset`);
        if (!String(asset.mime_type).startsWith('image/')) throw new Error('Choose a finished image, not a video or audio file.');
        if (cancelled || getJourney().task !== task) return;
        setModelId(next.id);
        setAnimationPortrait(null);
        setSources({ image: { assetId: imageId, previewUrl: asset.url, label: helperEnglish('walkthrough_image'), labelCode: 'walkthrough_image' } });
        setConsent(false);
        setPrompt(MOTION_DRAFT);
        setDuration('5s');
        updateJourney({ phase: 'video', imageId, videoJob: null, reviewed: {} });
      } catch (e) {
        if (!cancelled) publishJourneyView({ prepareError: e.message?.startsWith('Wait ') || e.message?.startsWith('This image') || e.message?.startsWith('Choose a finished') ? e.message : 'The image could not be reopened. Check your connection and account, then try again.' });
      } finally { busy = false; if (!cancelled) publishJourneyView({ preparing: false }); }
    };
    window.addEventListener(PREPARE_VIDEO, prepare);
    return () => { cancelled = true; window.removeEventListener(PREPARE_VIDEO, prepare); };
  }, [catalogLive, models, setModelId, setPrompt, setSources, setConsent, setDuration, setAnimationPortrait]);
}
