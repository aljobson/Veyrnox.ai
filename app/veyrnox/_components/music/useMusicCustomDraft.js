'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';
import { preserveSunoDraftText } from './musicSunoForm';

const blankDraft = (modelId, providerContract = null) => ({
  id: null,
  provider_contract: providerContract,
  model_id: modelId || 'ace-step',
  lyrics: '',
  styles: '',
  title: '',
  revision: 0,
  updated_at: null,
});

const MERGE_FIELDS = ['model_id', 'lyrics', 'styles', 'title'];

function mergeDraft(base, local, server) {
  const merged = { ...server };
  const overlap = [];
  for (const field of MERGE_FIELDS) {
    const localChanged = local[field] !== base[field];
    const serverChanged = server[field] !== base[field];
    if (localChanged && serverChanged && local[field] !== server[field]) overlap.push(field);
    merged[field] = localChanged ? local[field] : server[field];
  }
  return { merged, overlap };
}

function draftError(reason) {
  if (reason?.code === 'no_token' || reason?.code === 'unauthenticated') return 'Sign in to keep this Custom draft across devices.';
  if (reason?.code === 'music_unavailable') return 'Custom draft storage is paused. Your text remains on this page.';
  if (reason?.code === 'model_unavailable') return 'That draft target is no longer available. Choose a current model.';
  if (reason?.code === 'network_error') return 'The draft could not reach the server. Your text remains on this page.';
  return 'The draft could not be saved. Your text remains on this page.';
}

export function useMusicCustomDraft({ active, defaultModelId = 'ace-step', providerContract = null, onContractStale = null }) {
  const [draft, setDraft] = useState(() => blankDraft(defaultModelId));
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(null);
  const [notice, setNotice] = useState('');
  const [needsReview, setNeedsReview] = useState(false);
  const editSerial = useRef(0);
  const saving = useRef(false);
  const baseDraft = useRef(blankDraft(defaultModelId));
  const draftRef = useRef(blankDraft(defaultModelId));

  const load = useCallback(async () => {
    setStatus('loading');
    setLoadFailed(false);
    setError('');
    try {
      const result = await gatewayFetch('/music/drafts/custom');
      const next = result.draft
        ? { ...result.draft, provider_contract: result.draft.provider_contract || result.provider_contract }
        : blankDraft(defaultModelId, result.provider_contract || providerContract);
      baseDraft.current = next;
      draftRef.current = next;
      setDraft(next);
      setLoaded(true);
      setLoadFailed(false);
      setDirty(false);
      setConflict(null);
      setStatus('saved');
    } catch (reason) {
      setLoaded(true);
      setLoadFailed(true);
      setStatus('error');
      setError('The private draft could not be loaded. Retry before editing.');
    }
  }, [defaultModelId, providerContract]);

  useEffect(() => {
    if (!active || loaded) return undefined;
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [active, load, loaded]);

  const savePayload = useCallback(async (payload, serial) => {
    if (saving.current) return false;
    saving.current = true;
    setStatus('saving');
    setError('');
    try {
      const result = await gatewayFetch('/music/drafts/custom', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const savedDraft = { ...result.draft, provider_contract: result.draft.provider_contract || payload.provider_contract };
      baseDraft.current = savedDraft;
      setDraft((current) => {
        const next = {
          ...current,
          id: savedDraft.id,
          provider_contract: savedDraft.provider_contract || current.provider_contract,
          revision: savedDraft.revision,
          updated_at: savedDraft.updated_at,
        };
        draftRef.current = next;
        return next;
      });
      if (serial === editSerial.current) {
        setDirty(false);
        setNeedsReview(false);
        setStatus('saved');
      } else {
        setDirty(true);
        setStatus('unsaved');
      }
      return savedDraft;
    } catch (reason) {
      if (reason?.code === 'contract_stale') {
        const local = serial === editSerial.current ? payload : draftRef.current;
        setNotice('contract_refreshed');
        try {
          const result = await gatewayFetch('/music/drafts/custom');
          const server = result.draft
            ? { ...result.draft, provider_contract: result.draft.provider_contract || result.provider_contract }
            : blankDraft(defaultModelId, result.provider_contract || providerContract);
          const preserved = preserveSunoDraftText(server, local);
          baseDraft.current = server;
          draftRef.current = preserved;
          editSerial.current += 1;
          setDraft(preserved);
          setLoaded(true);
          setLoadFailed(false);
          setConflict(null);
          setDirty(true);
          setNeedsReview(true);
          setStatus('unsaved');
          await onContractStale?.();
        } catch {
          setError('Music controls changed, but the refreshed draft could not be loaded. Your text remains on this page.');
          setStatus('error');
          setDirty(true);
        }
      } else if (reason?.code === 'revision_conflict' && reason?.body?.draft) {
        const server = reason.body.draft;
        const local = serial === editSerial.current ? payload : draftRef.current;
        const resolution = mergeDraft(baseDraft.current, local, server);
        baseDraft.current = server;
        if (resolution.overlap.length === 0) {
          editSerial.current += 1;
          draftRef.current = resolution.merged;
          setDraft(resolution.merged);
          setConflict(null);
          setDirty(true);
          setStatus('unsaved');
        } else {
          setConflict({ local, server, overlap: resolution.overlap });
          setDirty(false);
          setStatus('conflict');
        }
      } else {
        setError(draftError(reason));
        setStatus('error');
        setDirty(false);
      }
      return false;
    } finally {
      saving.current = false;
    }
  }, [defaultModelId, onContractStale, providerContract]);

  useEffect(() => {
    if (!loaded || !dirty || needsReview || conflict || saving.current) return undefined;
    const payload = {
      provider_contract: draft.provider_contract,
      draft_id: draft.id,
      revision: draft.revision,
      model_id: draft.model_id,
      lyrics: draft.lyrics,
      styles: draft.styles,
      title: draft.title,
    };
    const serial = editSerial.current;
    const timer = window.setTimeout(() => savePayload(payload, serial), 650);
    return () => window.clearTimeout(timer);
  }, [conflict, dirty, draft, loaded, needsReview, savePayload, status]);

  const update = useCallback((field, value) => {
    editSerial.current += 1;
    setNotice('');
    setDraft((current) => {
      const next = { ...current, [field]: value };
      draftRef.current = next;
      return next;
    });
    setConflict((current) => current ? {
      ...current,
      local: { ...current.local, [field]: value },
    } : null);
    setDirty(true);
    setError('');
    setStatus((current) => current === 'conflict' ? current : 'unsaved');
  }, []);

  const saveNow = useCallback(() => {
    if (!loaded || saving.current || conflict) return false;
    const payload = {
      provider_contract: draft.provider_contract,
      draft_id: draft.id,
      revision: draft.revision,
      model_id: draft.model_id,
      lyrics: draft.lyrics,
      styles: draft.styles,
      title: draft.title,
    };
    return savePayload(payload, editSerial.current);
  }, [conflict, draft, loaded, savePayload]);

  const loadNewer = useCallback(() => {
    if (!conflict) return;
    baseDraft.current = conflict.server;
    draftRef.current = conflict.server;
    setDraft(conflict.server);
    setConflict(null);
    setDirty(false);
    setError('');
    setStatus('saved');
  }, [conflict]);

  const keepMine = useCallback(() => {
    if (!conflict) return;
    editSerial.current += 1;
    baseDraft.current = conflict.server;
    const next = { ...conflict.local, revision: conflict.server.revision, id: conflict.server.id };
    draftRef.current = next;
    setDraft(next);
    setConflict(null);
    setDirty(true);
    setError('');
    setStatus('unsaved');
  }, [conflict]);

  const retry = useCallback(() => {
    if (loadFailed) return load();
    if (!loaded) return load();
    setError('');
    setDirty(true);
    setStatus('unsaved');
  }, [load, loadFailed, loaded]);

  return {
    draft, loaded, loadFailed, dirty, status, error, conflict, notice, needsReview,
    update, saveNow, loadNewer, keepMine, retry,
  };
}
