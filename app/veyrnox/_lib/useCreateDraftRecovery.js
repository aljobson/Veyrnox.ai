'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getStoredUserId, onSessionChange } from '../../lib/authClient';
import { fromSharedDraft, readCreateDraft, reopenDraftSources, toSharedDraft, writeCreateDraft } from '../../../lib/createDraftRecovery';
import { clearRemoteDraft, fetchLibrarySync, pushDraft } from './librarySync';
import { gatewayFetch } from './gateway';

const actorSnapshot = () => getStoredUserId() || 'signed-out';
// The account copy of the draft (ADR-0340) is written a moment after the last change, so typing does not send a request per key.
const REMOTE_SAVE_MS = 1500;
export default function useCreateDraftRecovery({ draft, apply, reset, incoming }) {
  const actor = useSyncExternalStore(onSessionChange, actorSnapshot, () => null);
  const latest = useRef({ draft, apply, reset });
  const previousActor = useRef(null);
  const [loaded, setLoaded] = useState(null);
  const [status, setStatus] = useState('');
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [retry, setRetry] = useState(0);
  const saveBlocked = useRef(false);
  const remoteOk = useRef(false); // true once the account copy has answered for this account
  useEffect(() => { latest.current = { draft, apply, reset }; });
  useEffect(() => {
    if (!actor) return;
    let cancelled = false;
    saveBlocked.current = false;
    setLoaded(null);
    setSaved(false);
    setFailed(false); setBlocked(false);
    const restoringRetry = previousActor.current === actor && retry > 0;
    if (previousActor.current && previousActor.current !== actor) latest.current.reset();
    previousActor.current = actor;
    const restore = async () => {
      let saved;
      try { saved = readCreateDraft(sessionStorage, actor); } catch { /* Storage disabled. */ }
      const wanted = new URLSearchParams(location.search).get('model');
      if (incoming.current || (wanted && saved?.modelId !== wanted)) saved = null;
      // Nothing in this tab: the account's draft (words and settings only), if the phone or another tab left one.
      remoteOk.current = false;
      if (!incoming.current) {
        const remote = await fetchLibrarySync();
        if (cancelled || actorSnapshot() !== actor) return;
        remoteOk.current = remote.kind === 'ok';
        if (!saved && !wanted && remote.kind === 'ok') saved = fromSharedDraft(remote.draft);
      }
      if (!saved) { if (!cancelled) { setStatus(''); setLoaded(actor); } return; }
      setStatus('Restoring this tab’s draft…');
      const { restored, failed } = await reopenDraftSources(saved.sources, gatewayFetch);
      if (cancelled || actorSnapshot() !== actor) return;
      latest.current.apply(restoringRetry ? { ...saved, ...latest.current.draft } : saved, restored);
      saveBlocked.current = failed.length > 0 || saved.needsUpload;
      setFailed(failed.length > 0); setBlocked(saveBlocked.current);
      setStatus(failed.length ? 'Some saved Library sources could not reopen. Retry recovery or choose them again; nothing was generated.'
        : saved.needsUpload ? 'Settings restored. Reattach local uploads before continuing; Library sources have been reopened.'
        : 'Draft restored for this account. Review the current price and confirm source rights yourself before generating.');
      setLoaded(actor);
    };
    void restore();
    return () => { cancelled = true; };
  }, [actor, retry, incoming]);
  useEffect(() => {
    if (!actor || loaded !== actor || saveBlocked.current) return;
    try { setSaved(writeCreateDraft(sessionStorage, actor, draft)); } catch { setSaved(false); }
    if (!remoteOk.current) return undefined;
    const timer = setTimeout(() => {
      if (actorSnapshot() !== actor) return;
      const shared = toSharedDraft(draft);
      void (shared ? pushDraft(shared) : clearRemoteDraft());
    }, REMOTE_SAVE_MS);
    return () => clearTimeout(timer);
  }, [actor, loaded, draft]);
  return { restoring: loaded !== actor || !actor, status, saved, failed, blocked,
    retry: () => setRetry(value => value + 1),
    sourceEdited: () => { saveBlocked.current = false; setFailed(false); setBlocked(false); setStatus(''); },
  };
}
