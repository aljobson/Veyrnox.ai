'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { getStoredUserId, onSessionChange } from '../../lib/authClient.js';
import { gatewayFetch } from '../_lib/gateway';
import {
  MAX_SIGNATURE_VOICE_RECIPES,
  fetchOwnedAudioReference,
  readAudioReferenceShelf,
  readSignatureVoiceRecipeIds,
  saveAudioReference,
  toggleSignatureVoiceRecipe,
} from '../_lib/audioReferenceShelf';

const currentAccount = () => getStoredUserId() || '';
const serverAccount = () => '';

export function SaveToAudioShelfButton({ jobId, name, purpose, voiceRecipe, offerSignature = false, className = '' }) {
  const accountId = useSyncExternalStore(onSessionChange, currentAccount, serverAccount);
  const [state, setState] = useState('idle');
  const [signatureIds, setSignatureIds] = useState([]);
  const [itemId, setItemId] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const item = accountId && readAudioReferenceShelf(window.localStorage, accountId).find((candidate) => candidate.jobId === jobId);
      setState(item && (!voiceRecipe || item.voiceRecipe) ? 'saved' : 'idle');
      setItemId(item?.id || '');
      setSignatureIds(readSignatureVoiceRecipeIds(window.localStorage, accountId));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [accountId, jobId, voiceRecipe]);

  async function save() {
    if (state === 'checking' || state === 'saved') return;
    if (!accountId) {
      window.dispatchEvent(new CustomEvent('veyrnox:auth-required'));
      setState('signin');
      return;
    }
    setState('checking');
    try {
      await fetchOwnedAudioReference(gatewayFetch, jobId);
      const next = saveAudioReference(window.localStorage, accountId, { jobId, name, purpose, voiceRecipe });
      const saved = next.find((item) => item.jobId === jobId);
      setItemId(saved?.id || '');
      setState(saved ? 'saved' : 'error');
    } catch {
      setState('error');
    }
  }

  const label = state === 'checking' ? 'Checking owned audio…'
    : state === 'saved' ? 'Saved to Audio Shelf'
      : state === 'signin' ? 'Sign in to save'
        : state === 'error' ? 'Could not save · Retry'
          : voiceRecipe && readAudioReferenceShelf(window.localStorage, accountId).some((item) => item.jobId === jobId)
            ? 'Add Voice Recipe to Shelf'
            : 'Save to Audio Shelf';

  const signature = Boolean(itemId && signatureIds.includes(itemId));
  const signatureFull = !signature && signatureIds.length >= MAX_SIGNATURE_VOICE_RECIPES;

  return <>
    <button type="button" onClick={save} disabled={state === 'checking' || state === 'saved'}
      className={className || 'inline-flex min-h-9 items-center rounded-full border border-vx-border px-3 text-[11px] font-extrabold text-vx-fg disabled:opacity-60'}>{label}</button>
    {offerSignature&&voiceRecipe&&state==='saved'&&itemId&&<button type="button" disabled={signatureFull} aria-pressed={signature} onClick={() => setSignatureIds(toggleSignatureVoiceRecipe(window.localStorage, accountId, itemId))}
      className="inline-flex min-h-9 items-center rounded-full border border-vx-accent/40 px-3 text-[11px] font-extrabold text-vx-accent disabled:cursor-not-allowed disabled:opacity-40">{signature?'Unpin signature':signatureFull?'Signature set full':'Pin as signature'}</button>}
  </>;
}
