'use client';
// ADR-0327. Per-account AI switch and generation limits; reuses the switches.write permission.
import { useCallback, useEffect, useState } from 'react';
import { gatewayFetch } from '../../../_lib/gateway';
import { adminControl, adminError, adminWhen } from '../_components/AdminPanel';
import { useAdminMutation } from '../_components/useAdminMutation';

const ENDPOINT = '/admin/users/ai-control';
const reasonInvalid = r => !r.trim() || r.trim().length > 500 || /[\x00-\x1f\x7f]/.test(r);

export function AiControls({ offline }) {
  const [email, setEmail] = useState(''), [looked, setLooked] = useState(''), [data, setData] = useState(null), [error, setError] = useState('');
  const [disabled, setDisabled] = useState(false), [limit, setLimit] = useState(''), [reason, setReason] = useState('');
  const [globalLimit, setGlobalLimit] = useState(''), [globalReason, setGlobalReason] = useState('');
  const load = useCallback(async (address) => {
    setError('');
    try {
      const result = await gatewayFetch(ENDPOINT + (address ? '?email=' + encodeURIComponent(address) : ''));
      setData(result);
      setLooked(address);
      setGlobalLimit(result.global?.gen_limit_per_window ? String(result.global.gen_limit_per_window) : '');
      if (address) {
        setDisabled(!!result.user?.ai_disabled);
        setLimit(result.user?.gen_limit_per_window ? String(result.user.gen_limit_per_window) : '');
      }
    } catch (failure) { setError(adminError(failure)); }
  }, []);
  useEffect(() => { Promise.resolve().then(() => load('')); }, [load]);
  const userSave = useAdminMutation(ENDPOINT, () => load(looked));
  const globalSave = useAdminMutation(ENDPOINT, () => load(looked));
  const user = data?.user;
  const limitValue = v => (v === '' ? null : Number(v));
  const limitBad = v => v !== '' && !(Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 10);

  return <section className="mt-12 grid gap-4" aria-labelledby="ai-controls-title">
    <h2 id="ai-controls-title" className="font-vx text-xl font-bold">AI controls per account</h2>
    <p>Turn AI off for one account, or lower how many generations it may start per minute. A limit can only be lower than the built-in 10; it never raises it. Changes need an authenticator verification within five minutes and are recorded in the change log.</p>
    {error && <p role="alert" className="text-vx-danger">{error}</p>}

    <form className="grid gap-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); if (email.trim()) load(email.trim()); }}>
      <label className="grid gap-2 sm:col-span-2">Account email
        <input className={adminControl} type="email" maxLength={320} value={email} onChange={e => setEmail(e.target.value)} /></label>
      <button className={adminControl} disabled={offline || !email.trim()}>Look up account</button>
    </form>
    {looked && !user && <p role="status">No account found for that email.</p>}

    {user && <form className="grid gap-4 sm:grid-cols-2" onSubmit={e => {
      e.preventDefault();
      if (reasonInvalid(reason) || limitBad(limit)) return;
      userSave.save({ user_id: user.user_id, ai_disabled: disabled, gen_limit_per_window: limitValue(limit), reason: reason.trim() });
    }}>
      <p className="sm:col-span-2" role="status">
        {user.email}: AI is <strong>{user.ai_disabled ? 'off' : 'on'}</strong>
        {user.gen_limit_per_window ? `, limit ${user.gen_limit_per_window} per minute` : ', no limit override'}
        {user.updated_at ? ` (changed ${adminWhen(user.updated_at)})` : ''}.
      </p>
      <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={disabled} onChange={e => setDisabled(e.target.checked)} />
        Turn AI off for this account</label>
      <label className="grid gap-2">Generations per minute (1–10, blank = no override)
        <input className={adminControl} inputMode="numeric" value={limit} onChange={e => setLimit(e.target.value.trim())} aria-invalid={limitBad(limit)} /></label>
      <label className="grid gap-2 sm:col-span-2">Reason — no secrets
        <textarea className={adminControl} required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button className={adminControl + ' min-h-13 border-vx-accent text-vx-accent'} disabled={userSave.pending || offline || reasonInvalid(reason) || limitBad(limit)}>
        {userSave.pending ? 'Saving…' : 'Save account controls'}</button>
      <div className="sm:col-span-2" aria-live="polite">{userSave.error && <p role="alert" className="text-vx-danger">{userSave.error}</p>}{userSave.message && <p role="status">{userSave.message}</p>}</div>
    </form>}

    <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={e => {
      e.preventDefault();
      if (reasonInvalid(globalReason) || limitBad(globalLimit)) return;
      globalSave.save({ user_id: null, ai_disabled: false, gen_limit_per_window: limitValue(globalLimit), reason: globalReason.trim() });
    }}>
      <h3 className="font-vx text-lg font-bold sm:col-span-2">Limit for every account</h3>
      <label className="grid gap-2">Generations per minute (1–10, blank = built-in 10)
        <input className={adminControl} inputMode="numeric" value={globalLimit} onChange={e => setGlobalLimit(e.target.value.trim())} aria-invalid={limitBad(globalLimit)} /></label>
      <label className="grid gap-2 sm:col-span-2">Reason — no secrets
        <textarea className={adminControl} required maxLength={500} value={globalReason} onChange={e => setGlobalReason(e.target.value)} /></label>
      <button className={adminControl + ' min-h-13 border-vx-accent text-vx-accent'} disabled={globalSave.pending || offline || reasonInvalid(globalReason) || limitBad(globalLimit)}>
        {globalSave.pending ? 'Saving…' : 'Save global limit'}</button>
      <div className="sm:col-span-2" aria-live="polite">{globalSave.error && <p role="alert" className="text-vx-danger">{globalSave.error}</p>}{globalSave.message && <p role="status">{globalSave.message}</p>}</div>
    </form>
  </section>;
}
