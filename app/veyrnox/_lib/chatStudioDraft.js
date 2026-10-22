import { writeStudioDraft } from './landingDraft.js';

/** Stage one checked Chat draft for Create. Null means storage failed, so navigation must not happen. */
export function stageChatStudioDraft(storage, draft, oddlingHandoff = null, now = Date.now()) {
  const written = writeStudioDraft(storage, {
    prompt: draft.prompt,
    model: draft.model,
    aspect: draft.aspect,
    ...(oddlingHandoff ? { oddlingPicks: oddlingHandoff.picks } : {}),
  }, now);
  if (!written) return null;
  let destination = `/app/create?model=${encodeURIComponent(draft.model)}`;
  if (!oddlingHandoff) return destination;
  destination += '&oddling=1&passport=1';
  if (draft.kind === 'video' && draft.needs.includes('image') && oddlingHandoff.portraitId) {
    destination += `&oddlingPhoto=${encodeURIComponent(oddlingHandoff.portraitId)}`;
    if (oddlingHandoff.motionId) destination += `&motion=${encodeURIComponent(oddlingHandoff.motionId)}`;
  }
  return destination;
}
