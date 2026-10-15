// Deterministic local guidance. No prompts, passports or signed URLs go to AI or telemetry.
export const JOURNEY_KEY = 'veyrnox_vey_journey_v1';
export const PREPARE_VIDEO = 'veyrnox:prepare-journey-video';
export const MOTION_DRAFT = 'Animate the exact character in the supplied start image. A subtle head turn, natural breathing and a small friendly wave. Preserve the face, hair, physique and outfit. Keep the whole character in frame, static camera, no cuts or morphing.';
const id = (value) => typeof value === 'string' && /^[\w-]{1,80}$/.test(value) ? value : null;

export function cleanJourney(value, owner) {
  if (!value || value.owner !== owner || !['image', 'video'].includes(value.phase)) return null;
  if (!Number.isFinite(value.updatedAt) || Date.now() - value.updatedAt > 86400000) return null;
  return { owner, phase: value.phase, passportId: id(value.passportId), imageId: id(value.imageId),
    imageJob: id(value.imageJob), videoJob: id(value.videoJob), handedOff: value.handedOff === true, updatedAt: value.updatedAt,
    reviewed: Object.fromEntries(Object.entries(value.reviewed || {}).filter(([key, val]) =>
      ['prompt', 'settings', 'cost', 'videoPrompt', 'duration', 'videoCost'].includes(key) && typeof val === 'string' && val.length <= 300)) };
}

export function journeyStep(task, view = {}) {
  if (!task) return null;
  view = { ...view, handedOff: task.handedOff || view.handedOff };
  const step = (key, title, message, target, extra = {}) => ({ key, title, message, target, ...extra });
  const video = task.phase === 'video';
  const jobId = video ? task.videoJob : task.imageJob;
  if (jobId) {
    const job = view.jobs?.find((j) => j.job_id === jobId);
    if (!job) return step('recover', 'Checking your job', 'Reopening this account’s job. If it cannot be read, open Library; no new job will be submitted.', 'nav.library');
    if (job.state === 'failed') return step('failed', 'Generation failed', 'Review the error in Create or Library. Vey will never retry or spend again automatically.', 'create.result', { retry: true });
    if (job.state !== 'succeeded') return step('waiting', 'Generation in progress', 'Your submitted job is still processing. You can close Vey and return; do not submit another copy.', 'create.result');
    return video
      ? step('complete', 'Your video is ready', 'The video has finished. Open the result in Library to play or download it.', 'nav.library')
      : step('imageReady', 'Your image is ready', 'Use this exact finished image as the video start frame. Preparing a draft costs nothing; generation needs your approval.', 'create.result', { prepare: true });
  }
  if (!video && view.route === '/app/oddlings') {
    if (view.loadedId !== task.passportId) return step('load', 'Load your saved passport', 'Choose Load and edit on the highlighted saved version. Vey does not replace your character silently.', 'oddlings.saved');
    return step('handoff', 'Review your character and scene', 'Check the loaded character and scene, then choose Continue to portrait generation. The passport and scene travel to Create together.', 'oddlings.continue');
  }
  if (view.route !== '/app/create') return step('return', 'Return to your task', 'Open the workspace to continue. Your walkthrough is kept in this tab for up to 24 hours.', video || view.handedOff ? 'nav.create' : 'nav.oddlings');
  if (!video && !view.handedOff) return step('passport', 'Bring your saved character into Create', 'Return to Oddling Studio, load the saved version, and Continue to portrait generation. An unrelated Create draft is not this character.', 'nav.oddlings');
  if (view.kind !== (video ? 'video' : 'image') || (video && !view.imageRequired)) return step('model', video ? 'Choose image-to-video' : 'Choose an image model', video ? 'Choose a video model with a required start image. Prices come from the current catalog.' : 'Choose an IMAGE model. Your character styling must stay enabled.', 'create.models', { prepare: video && !!task.imageId });
  if (!video && !view.characterOn) return step('character', 'Enable your character', 'Turn on character styling so the passport is included in the image request. Review its traits before generating.', 'create.character');
  if (video && (!task.imageId || view.sourceId !== task.imageId)) return step('source', 'Choose the exact image', task.imageId ? 'The start image was removed or replaced. Restore the tracked image; Vey will not substitute a cast portrait.' : 'Choose From library, preview your saved character image and select it. Then confirm it below as this walkthrough’s start frame.', 'create.upload', { adopt: !!view.sourceId && !task.imageId, prepare: !!task.imageId });
  const promptKey = video ? 'videoPrompt' : 'prompt';
  if (!view.promptReady || task.reviewed[promptKey] !== view.promptStamp) return step(promptKey, video ? 'Describe the movement' : 'Review your image scene', video ? 'Describe movement, camera and what must remain unchanged. Review the motion prompt, then continue.' : 'Review the scene prompt. Character styling is combined with it when you generate.', 'create.prompt', { review: view.promptReady, stamp: view.promptStamp });
  const settingsKey = video ? 'duration' : 'settings';
  if (task.reviewed[settingsKey] !== view.settingsStamp) return step(settingsKey, video ? 'Review video length and shape' : 'Review image settings', video ? 'Review the offered duration and aspect ratio. Changing either invalidates the cost review.' : 'Review image count, shape and optional camera or advanced settings. Each image may cost Credits.', video ? 'create.duration' : 'create.count', { review: true, stamp: view.settingsStamp });
  if (view.missingSource) return step('required', 'Add required sources', 'This model still needs a source file. Supply the required inputs before continuing.', 'create.upload');
  if (view.missingConsent) return step('consent', 'Confirm source rights yourself', 'Read the rights statement. Only you can tick it if it is true. Vey cannot provide this attestation for you.', 'create.consent');
  const costKey = video ? 'videoCost' : 'cost';
  if (task.reviewed[costKey] !== view.costStamp) return step(costKey, 'Review the current price', `Current estimate: ${view.cost ?? 'loading'} Credits${view.balance == null ? '; balance loading' : `; balance ${view.balance} Credits`}. Check the live price and inputs. Reviewing does not generate anything.`, 'create.cost', { review: view.cost != null && view.balance != null, stamp: view.costStamp });
  return step('generate', 'Ready for your decision', view.error ? 'The workspace reports an error from the previous attempt. Review it before deciding whether to submit again. Vey has not retried anything.' : view.canGenerate ? 'All required inputs are ready. Personally press Generate if the current price is acceptable. Vey will track that job, then guide you to the next stage.' : 'Generate is unavailable. Review the workspace error, balance and model availability. Vey will not bypass these checks.', 'create.generate');
}
