'use client';
import { useRef, useState } from 'react';
import { gatewayFetch } from '../../../_lib/gateway';
import { adminError } from './AdminPanel';
const COPY = {
  ticket_erased: 'This account was erased. The ticket is read-only.',
  ticket_not_found: 'The ticket no longer exists. Return to the inbox.',
  assignee_invalid: 'Choose an active owner or support administrator user ID.',
  plan_in_use: 'This pack has recent pending purchases. Wait for settlement or checkout expiry and try again.',
  plan_read_only: 'This catalog entry is read-only.',
  catalog_not_found: 'This catalog entry no longer exists. Refresh the list.',
  idempotency_key_reused: 'That request key belongs to a different change. Edit the reason before trying again.',
  self_role_change: 'You cannot change your own role. Ask another owner.',
  no_role: 'This user has no role to revoke. Refresh the list.',
  last_owner: 'At least one active owner must remain.',
  target_not_admin: 'This user must first have administrator access granted by the existing SQL process.',
  user_not_found: 'The selected user no longer exists. Refresh the list.',
  reason_invalid: 'Enter a reason of 1–500 characters without control characters or secrets.',
  input_invalid: 'Check the selected fields and reason, then retry.',
};
export function useAdminMutation(endpoint, onSaved) {
  const [pending,setPending] = useState(false), [message,setMessage] = useState(''), [error,setError] = useState('');
  const [signIn,setSignIn] = useState(false);
  const request = useRef(null), busy = useRef(false);
  async function save(body) {
    if (busy.current) return;
    if (!navigator.onLine) { setError('Reconnect before saving. Your input is kept.'); return; }
    const fingerprint = JSON.stringify(body);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    busy.current = true; setPending(true); setMessage(''); setError(''); setSignIn(false);
    try {
      await gatewayFetch(endpoint, { method:'POST', headers: { 'Idempotency-Key':request.current.key }, body: JSON.stringify(body) });
      request.current = null; // A confirmed save ends this intent; uncertain retries keep their key.
      setMessage('Change saved and recorded in the change log.');
      await onSaved();
    } catch (failure) { setSignIn(failure.status===401); setError(COPY[failure.code] || adminError(failure)); }
    finally { busy.current = false; setPending(false); }
  }
  return { save,pending,message,error,signIn };
}
