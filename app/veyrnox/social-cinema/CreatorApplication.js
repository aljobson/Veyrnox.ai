'use client';
import { useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../_lib/gateway';
import { Button } from '../_components/Button';

export function CreatorApplication() {
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
      if (current) { setState(e.code === 'creators_not_open' ? 'closed' : 'error'); setError(copy(e.code)); }
    });
    return () => { current = false; };
  }, [version]);
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
      else { setError(copy(e.code)); setState('ready'); }
    }
  }
  if (state === 'closed') return null;
  return <section className="mt-8 border-t border-vx-border pt-6" aria-labelledby="creator-title">
    <h3 id="creator-title" className="text-xl font-bold">Become a Cinema creator</h3>
    {state === 'loading' ? <p role="status" className="mt-4">Loading your application…</p> : state === 'error' ? <div className="mt-4"><p role="alert">{error}</p><Button className="mt-3" onClick={() => { setState('loading'); setVersion(n => n + 1); }}>Try again</Button></div> : application ? <div className="mt-4">
      <p role="status">{({ pending: 'Your application is waiting for review.', approved: 'Your creator application is approved. Uploading and publishing are not open yet.', rejected: 'Your application was not approved. Contact support if you need help.' })[application.status]}</p>
      <p className="mt-3 whitespace-pre-wrap break-words text-vx-fg-muted">{application.statement}</p>
    </div> : <form onSubmit={submit} className="mt-4 max-w-lg space-y-4">
      <p className="text-sm text-vx-fg-body">Tell us about the films or series you want to make. Your application is private and reviewed by the Cinema team. Do not include payment or identity documents.</p>
      <label className="block font-semibold" htmlFor="creator-statement">Your creative plans<textarea id="creator-statement" name="statement" required minLength={20} maxLength={1000} rows={5} className="mt-2 w-full rounded-xl border border-vx-border bg-vx-panel p-3 focus-visible:outline-vx-accent" /></label>
      <p className="text-xs text-vx-fg-muted">20–1,000 characters. Approval does not enable monetisation or payouts.</p>
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={state === 'saving'}>{state === 'saving' ? 'Submitting…' : 'Apply to become a creator'}</Button>
    </form>}
  </section>;
}
function copy(code) {
  return ({ account_not_active: 'Your Cinema account cannot apply right now. Contact support.', rate_limited: 'Too many requests. Wait a minute and try again.', invalid_application: 'Describe your creative plans in 20–1,000 characters.', role_not_eligible: 'Your account already has a Cinema role. Contact support for help.' })[code] || 'Your application is unavailable right now. Please try again.';
}
