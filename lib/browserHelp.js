import { journeyStep } from './veyJourney.js';
import { savedOddlingHelp } from './savedOddlingHelp.js';

const local = (message, target) => ({ message, target, action: 'show_target', source: 'local', localOnly: true });

function attachedImageHelp(question, { pathname, view = {}, task, selectedId }) {
  if (selectedId || pathname !== '/app/create' || view.route !== '/app/create' || view.kind !== 'video' || !view.imageRequired) return null;
  const q = question.toLowerCase();
  const attached = view.sourceAttached ?? !!view.sourceId;
  const tracked = task?.phase === 'video' && task.imageId;
  if (!attached && !tracked) return null;
  // A deliberate passport-management request still goes to the saved library.
  if (/\b(load|edit|open|browse|list|show|compare|delete|save|choose|select|switch|replace)\b.*\b(passports?|history|saved (?:oddlings?|characters?))\b/.test(q)) return null;
  const origin = /\b(which|what)\b.*\b(passport|version)\b.*\b(used|using|image|attached|current)\b/.test(q);
  if (!origin && /\b(which|what|where)\b.*\b(passports?|history|saved (?:oddlings?|characters?))\b/.test(q)) return null;
  if (!origin && !/\b(image|photo|picture|frame|attached|already|animat\w*|video|motion|consisten\w*|preserv\w*|keep|outfit|face|hair|appearance|morph\w*)\b/.test(q)) return null;
  if (!attached) return local('There is no start image attached now. Restore the image tracked by this walkthrough using From library; you do not need to choose a saved passport.', 'create.upload');
  if (tracked && view.sourceId !== tracked) return local('An image is attached, but it is different from the image tracked by this walkthrough. Use From library to restore the tracked image, or deliberately start a new walkthrough for the replacement. I will not switch images or choose a passport for you.', 'create.upload');
  const context = 'I’m using the image already attached to your video draft as the start frame. You do not need to choose a saved passport again.';
  if (origin) return local(`${context} A Library image does not identify which saved passport version created it, so I will not guess that version.`, 'create.upload');
  if (/\b(face|hair|outfit|appearance|identity|consisten\w*|preserv\w*|keep|morph\w*)\b/.test(q)) return local(`${context} Use subtle motion and a prompt such as: “Animate the supplied start image. Preserve the same face, hair, physique and outfit. Static camera; no cuts, morphing or outfit changes.” Inspect the result for changes; a prompt cannot guarantee perfect consistency.`, 'create.prompt');
  if (/\b(duration|length|seconds?|long)\b/.test(q)) return local(`${context} Review the durations offered by the selected image-to-video model. Changing duration means reviewing the price again; it does not submit anything.`, 'create.duration');
  if (/\b(cost|price|credits?)\b/.test(q)) return local(`${context} The current estimate is ${view.cost ?? 'still loading'} Credits. Check Total cost before deciding to generate; only you can submit.`, 'create.cost');
  const step = task && journeyStep(task, { ...view, route: pathname });
  return local(`${context} ${step ? `${step.title}. ${step.message}` : 'Describe the movement in Prompt, review duration and Total cost, then personally confirm source rights and decide whether to generate.'}`, step?.target || 'create.prompt');
}

// Draft context is browser-only: no image bytes, URLs, prompts or saved traits
// are added to the help API request, telemetry or public conversation history.
export function browserHelpPlan(question, storage, context = {}) {
  if (context.selectedId) return savedOddlingHelp(question, storage, context);
  const step = context.task && /\b(next|progress|task|walkthrough|what now|where am i)\b/i.test(question)
    ? journeyStep(context.task, { ...context.view, route: context.pathname }) : null;
  if (step) return local(`${step.title}. ${step.message}`, step.target);
  return attachedImageHelp(question, context) || savedOddlingHelp(question, storage, context);
}
