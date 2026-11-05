// Why Generate is greyed out, in the order the submit handler checks, so the person is told what to fix instead of
// facing a silent grey button. Only conditions the person can fix: nothing while the catalog or balance is still
// loading (attaching a file cannot help yet), for a gated model, while sending, or after a result exists. An over-long
// prompt already has its own message beside the box, and it comes before the later checks in onSubmit, so it
// suppresses every hint rather than showing a later failure.

// The error codes whose existing copy each hint reuses (createErrors ERROR_COPY); reattach and duration have their own strings.
export const HINT_CODES = {
  too_many: 'source_count_exceeded',
  source: 'source_required',
  consent: 'consent_required',
  prompt: 'inputs_invalid:prompt',
  voice: 'inputs_invalid:voice_description',
};

export function generateHintKey({ ready, gated, sending, hasJobs, promptTooLong, needsReattach, overLimit, missingSource,
  animationMismatch, missingConsent, missingPrompt, missingVoice, invalidAudioDuration }) {
  if (!ready || gated || sending || hasJobs || promptTooLong) return null;
  if (needsReattach) return 'reattach';
  if (overLimit) return 'too_many';
  if (missingSource || animationMismatch) return 'source';
  if (missingConsent) return 'consent';
  if (missingPrompt) return 'prompt';
  if (missingVoice) return 'voice';
  if (invalidAudioDuration) return 'duration';
  return null;
}
