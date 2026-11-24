'use client';

import { useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { SMART_CUT_FEEDBACK_COMMENT_MAX, SMART_CUT_FEEDBACK_PATH } from '../../../lib/smartCutFeedback';
import { gatewayFetch } from '../_lib/gateway';

export function SmartCutFeedback({ responseId, planMode, fetcher = gatewayFetch }) {
  const { t } = useI18n();
  const [rating, setRating] = useState('');
  const [comment, setComment] = useState('');
  const [state, setState] = useState('idle');
  const [submissionId, setSubmissionId] = useState(responseId);
  const edit = (change) => {
    if (state === 'error') setSubmissionId(crypto.randomUUID());
    change();
    setState('idle');
  };

  async function send() {
    if (!rating || state === 'sending' || state === 'sent') return;
    setState('sending');
    try {
      await fetcher(SMART_CUT_FEEDBACK_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response_id: submissionId, rating, ...(comment.trim() ? { comment: comment.trim() } : {}), plan_mode: planMode }),
      });
      setState('sent');
    } catch {
      setState('error');
    }
  }

  if (state === 'sent') return <p role="status" className="mt-4 rounded-xl border border-vx-border bg-vx-base p-3 text-xs font-bold text-vx-fg-body">{t('app.smartCut.feedback.thanks')}</p>;
  return (
    <fieldset className="mt-4 rounded-xl border border-vx-border bg-vx-base p-3">
      <legend className="px-1 text-xs font-black text-vx-fg-body">{t('app.smartCut.feedback.title')}</legend>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={t('app.smartCut.feedback.title')}>
        <button type="button" aria-pressed={rating === 'up'} onClick={() => edit(() => setRating('up'))} className="min-h-11 rounded-full border border-vx-border px-4 text-xs font-bold aria-pressed:border-vx-accent aria-pressed:bg-vx-accent aria-pressed:text-vx-accent-ink">{t('app.smartCut.feedback.up')}</button>
        <button type="button" aria-pressed={rating === 'down'} onClick={() => edit(() => setRating('down'))} className="min-h-11 rounded-full border border-vx-border px-4 text-xs font-bold aria-pressed:border-vx-accent aria-pressed:bg-vx-accent aria-pressed:text-vx-accent-ink">{t('app.smartCut.feedback.down')}</button>
      </div>
      {rating && <div className="mt-3 grid gap-2">
        <label className="text-[11px] font-bold text-vx-fg-muted">{t('app.smartCut.feedback.comment')}
          <textarea value={comment} maxLength={SMART_CUT_FEEDBACK_COMMENT_MAX} rows="3" onChange={(event) => edit(() => setComment(event.target.value))} placeholder={t('app.smartCut.feedback.placeholder')} className="mt-1 min-h-20 w-full resize-y rounded-xl border border-vx-border bg-vx-panel px-3 py-2 text-sm text-vx-fg focus:border-vx-accent focus:outline-hidden" />
        </label>
        <p className="text-[10px] leading-4 text-vx-fg-muted">{t('app.smartCut.feedback.privacy')}</p>
        <button type="button" disabled={state === 'sending'} onClick={() => void send()} className="min-h-11 justify-self-start rounded-full bg-vx-accent px-4 text-xs font-extrabold text-vx-accent-ink disabled:opacity-40">{t(state === 'sending' ? 'app.smartCut.feedback.sending' : 'app.smartCut.feedback.send')}</button>
        {state === 'error' && <p role="alert" className="text-xs font-bold text-vx-danger">{t('app.smartCut.feedback.error')}</p>}
      </div>}
    </fieldset>
  );
}
