'use client';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../_lib/gateway';
import { Button } from '../_components/Button';

export function CreatorApplication() {
  const { t } = useI18n();
  const [application, setApplication] = useState(null);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const attempt = useRef(null);
  useEffect(() => {
    let current = true;
    gatewayFetch('/creators/apply').then(data => {
      if (current) { setApplication(data.application); setState('ready'); }
    }).catch(e => {
      if (current) { setState(e.code === 'creators_not_open' ? 'closed' : 'error'); setError(copy(e.code, t)); }
    });
    return () => { current = false; };
  }, [version, t]);
  async function submit(event) {
    event.preventDefault();
    const statement = new FormData(event.currentTarget).get('statement').trim();
    if (attempt.current?.statement !== statement) attempt.current = { statement, key: crypto.randomUUID() };
    setState('saving'); setError('');
    try {
      await gatewayFetch('/creators/apply', { method: 'POST', body: JSON.stringify({ statement }), headers: { 'idempotency-key': attempt.current.key } });
      setState('loading'); setVersion(n => n + 1);
    } catch(e) {
      if (e.code === 'application_exists') { setState('loading'); setVersion(n => n + 1); }
      else { setError(copy(e.code, t)); setState('ready'); }
    }
  }
  if (state === 'closed') return null;
  return <section className="mt-8 border-t border-vx-border pt-6" aria-labelledby="creator-title">
    <h3 id="creator-title" className="text-xl font-bold">{t("cinema.creatorApplication.becomeACinemaCreator")}</h3>
    {state === 'loading' ? <p role="status" className="mt-4">{t("cinema.creatorApplication.loadingYourApplication")}</p> : state === 'error' ? <div className="mt-4"><p role="alert">{error}</p><Button className="mt-3" onClick={() => { setState('loading'); setVersion(n => n + 1); }}>{t("recovery.retry")}</Button></div> : application ? <div className="mt-4">
      <p role="status">{({ pending: t("cinema.creatorApplication.yourApplicationIsWaitingForReview"), approved: t("cinema.creatorApplication.yourCreatorApplicationIsApprovedUploading"), rejected: t("cinema.creatorApplication.yourApplicationWasNotApprovedContact") })[application.status]}</p>
      <p className="mt-3 whitespace-pre-wrap wrap-break-word text-vx-fg-muted">{application.statement}</p>
    </div> : <form onSubmit={submit} className="mt-4 max-w-lg space-y-4">
      <p className="text-sm text-vx-fg-body">{t("cinema.creatorApplication.tellUsAboutTheFilmsOr")}</p>
      <label className="block font-semibold" htmlFor="creator-statement">{t("cinema.creatorApplication.yourCreativePlans")}<textarea id="creator-statement" name="statement" required minLength={20} maxLength={1000} rows={5} className="mt-2 w-full rounded-xl border border-vx-border bg-vx-panel p-3 focus-visible:outline-vx-accent" /></label>
      <p className="text-xs text-vx-fg-muted">{t("cinema.creatorApplication.201000CharactersCreatorEarning")}</p>
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={state === 'saving'}>{state === 'saving' ? t("cinema.creatorApplication.submitting") : t("cinema.creatorApplication.applyToBecomeACreator")}</Button>
    </form>}
  </section>;
}
function copy(code, t) {
  return ({ account_not_active: t("cinema.creatorApplication.yourCinemaAccountCannotApplyRight"), rate_limited: t("cinema.creatorApplication.tooManyRequestsWaitAMinute"), invalid_application: t("cinema.creatorApplication.describeYourCreativePlansIn20"), role_not_eligible: t("cinema.creatorApplication.yourAccountAlreadyHasACinema") })[code] || t("cinema.creatorApplication.yourApplicationIsUnavailableRightNow");
}
