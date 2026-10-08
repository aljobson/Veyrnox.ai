import { ACCOUNT_PAUSED_COPY } from './gateway';

// What the create page says for each gateway error code.
export const ERROR_COPY = {
  // A submit whose reply never arrived (imageBatch.submitErrorCode): it may have been charged.
  outcome_unknown:       'We lost the reply to this request, so it may have started and been charged. Open Library to check before trying again.',
  poll_unreachable:      'Lost contact with the server, so we stopped checking. Your generation may still have run — open Library to see.',
  moderation:            'The provider declined this prompt on safety grounds. Credits refunded.',
  // The code grsai and byteplus emit on a failed job, and Jev on a refused submit (ADR-0066).
  provider_moderation:   'The provider declined this prompt on safety grounds. Credits refunded.',
  provider_input_rejected:'The model would not accept one of these settings or inputs. Credits refunded — change it and try again.',
  provider_submit_failed:'The model would not take this job. Credits refunded — try again.',
  provider_timeout:      'The model took too long. Credits refunded — try again.',
  provider_error:        'The model returned an error. Credits refunded.',
  internal:              'Something on our side broke. Credits refunded.',
  rate_limited:          'Too many generations in a short window. Wait a moment.',
  model_gated:           'This model is not open for generation yet. Nothing was charged.',
  model_region_unavailable: 'This model is unavailable in your region. Choose another model. Nothing was charged.',
  duration_not_supported:'This model only makes 5s clips. Nothing was charged.',
  duration_invalid:      'Pick a 5s or 10s clip. Nothing was charged.',
  insufficient_balance:  'Not enough credits for this generation. Nothing was charged — top up to continue.',
  account_frozen:        ACCOUNT_PAUSED_COPY,
  user_not_provisioned:  'Your account is still being set up. Try again in a moment.',
  debit_rejected:        'The ledger declined this debit. Nothing was charged.',
  no_token:              'Sign in to generate.',
  unauthenticated:       'Sign in to generate.',
  source_required:       'This model needs every upload marked REQUIRED. Nothing was charged.',
  upload_failed:         'The upload did not finish. Nothing was charged — try again.',
  upload_type_not_allowed:'That file type is not accepted here. Nothing was charged.',
  upload_type_mismatch:  'That file is not the type it claims to be. Nothing was charged.',
  upload_too_large:      'That file is over the size limit (20 MB, or 100 MB for video). Nothing was charged.',
  upload_unreadable:     'We could not read that file. Nothing was charged.',
  source_not_found:      'An upload expired. Add it again. Nothing was charged.',
  source_too_large:      'That image has too many pixels for this model. Use a smaller one. Nothing was charged.',
  source_size_unknown:   'We could not read that image\'s size. Try a PNG. Nothing was charged.',
  source_too_long:       'That recording is longer than this model takes (see the limit on the upload). Nothing was charged.',
  source_length_unknown: 'We could not read that file\'s length. Try a WAV or an MP3 without cover art. Nothing was charged.',
  consent_required:      'Tick the consent box: you need to own the file you uploaded, or have the permission of everyone in it. Nothing was charged.',
  'inputs_invalid:topic':'A topic is 3 to 200 characters of plain text on one line. Nothing was charged.',
  topic_refused:        'That topic can\'t be made into a short: try a factual subject without real people. Credits refunded.',
  dialogue_invalid:      'Write one line per speaker, like "Ana: Hello!", with up to four speakers. Nothing was charged.',
  // Video agent (ADR-0074). Plan errors happen before any charge; the run errors are worded for a refund that has landed.
  video_agent_unavailable: 'The video agent isn\'t open yet. Nothing was charged.',
  'inputs_invalid:brief': 'A brief is 3 to 500 characters of plain text. Nothing was charged.',
  plan_unavailable:      'We couldn\'t make a plan right now. Nothing was charged — try again in a minute.',
  plan_expired:          'This plan expired. Make a new plan to continue. Nothing was charged.',
  plan_invalid:          'This plan is no longer valid. Make a new plan. Nothing was charged.',
  plan_mismatch:         'The brief changed after the plan was made. Make a new plan. Nothing was charged.',
  plan_price_changed:    'The price changed since this plan was made. Make a new plan to see it. Nothing was charged.',
  plan_key_mismatch:     'This plan can\'t be approved that way. Make a new plan. Nothing was charged.',
  video_agent_in_progress:'You already have a video being made. Nothing was charged — start another when it finishes.',
  video_agent_busy:      'Every video agent slot is in use right now. Nothing was charged — try again in a few minutes.',
  video_agent_offline:   'The video agent can\'t be reached right now. Nothing was charged — try again shortly.',
  brief_refused:         'That brief can\'t be made into a video: it must not show real, named people, minors in harm\'s way, or sexual or hateful content. Credits refunded.',
  video_agent_failed:    'The video could not be made. Credits refunded.',
  montage_failed:        'The video could not be made. Credits refunded.',
  runner_submit_failed:  'We couldn\'t start the video. Credits refunded — try again.',
  step_not_recorded:     'We couldn\'t start the video. Credits refunded — try again.',
  step_timeout:          'The video took too long and was stopped. Credits refunded.',
  output_missing:        'The video finished but could not be saved. Credits refunded.',
  output_invalid:        'The video finished but could not be saved. Credits refunded.',
  'inputs_invalid:prompt':'The prompt is empty or too long for this model (speech takes up to 1000 characters). Nothing was charged.',
};

// What a FAILED job says. "Credits refunded" only once /jobs/:id reports the
// refund (refunded: true); a failed job's refund can still be on its way.
// That covers the per-code copy above too, which is worded for a refund that
// has landed.
export function failedJobCopy(job) {
  const copy = ERROR_COPY[job.error_code] || 'Something went wrong. Credits refunded.';
  return job.refunded === true ? copy : copy.replace('Credits refunded', 'Your credits are on their way back');
}
