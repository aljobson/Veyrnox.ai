'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMusicCustomDraft } from '../music/useMusicCustomDraft';
import { useMusicServerState } from '../music/useMusicServerState';
import {
  isSunoContract, SUNO_CONTROL_DEFAULTS, sunoCustomQuoteRequest, sunoCustomReady,
  sunoControlsForModel, sunoLimit, sunoSimpleQuoteRequest,
} from '../music/musicSunoForm';

export function useChatMusicGeneration({ active, prompt }) {
  // Song pairs live in the Music generation canvas only. They never create a
  // persisted Chat thread message in this v1 path.
  const server = useMusicServerState({ active });
  const { entitlements, quote, busy, clearQuote, quoteRevisionNow, reviewQuote, confirmQuote } = server;
  const sunoModels = useMemo(() => (entitlements?.models || []).filter(isSunoContract), [entitlements]);
  const customModel = sunoModels.find((item) => item.generation_modes?.includes('custom'));
  const [offerId, setOfferId] = useState('ace-step');
  const [customMode, setCustomMode] = useState(false);
  const [controls, setControls] = useState(SUNO_CONTROL_DEFAULTS);
  const model = sunoModels.find((item) => item.id === (customMode ? customModel?.id : offerId)) || sunoModels[0] || null;
  const effectiveControls = sunoControlsForModel(model, controls);
  const custom = useMusicCustomDraft({
    active: active && sunoModels.length > 0 && customMode,
    defaultModelId: customModel?.id || 'ace-step-1.5',
    providerContract: customModel?.provider_contract || null,
    onContractStale: server.reload,
  });

  useEffect(() => {
    if (customMode && custom.loaded && customModel?.id && custom.draft.model_id !== customModel.id) custom.update('model_id', customModel.id);
  }, [custom, customMode, customModel]);

  function invalidate() {
    clearQuote();
  }

  useEffect(() => { clearQuote(); }, [clearQuote, prompt]);

  function updateControl(field, value) {
    setControls((current) => ({ ...current, [field]: value }));
    invalidate();
  }

  function updateDraft(field, value) {
    custom.update(field, value);
    invalidate();
  }

  function selectOffer(id) {
    setOfferId(id);
    const next = sunoModels.find((item) => item.id === id);
    if (next?.instrumental_only) setControls((current) => ({ ...current, instrumental: true }));
    invalidate();
  }

  function setCustom(next) {
    setCustomMode(next);
    invalidate();
  }

  async function action() {
    if (!model || busy) return false;
    if (quote) return Boolean(await confirmQuote({ title: customMode ? custom.draft.title.trim() : '' }));
    if (customMode) {
      if (!String(custom.draft.styles || '').trim() || !sunoCustomReady({ model, draft: custom.draft, controls })) return false;
      const startedAt = quoteRevisionNow();
      const saved = custom.dirty || !custom.draft.id ? await custom.saveNow() : custom.draft;
      if (!saved) return false;
      return Boolean(await reviewQuote(sunoCustomQuoteRequest({ model, draft: saved, controls: effectiveControls }), startedAt));
    }
    const brief = String(prompt || '').trim();
    if (!brief || Array.from(brief).length > sunoLimit(model, 'prompt')) return false;
    return Boolean(await reviewQuote(sunoSimpleQuoteRequest({ model, prompt: brief, instrumental: effectiveControls.instrumental })));
  }

  const generations = server.generations;
  const generating = generations.some((item) => !['succeeded', 'partial', 'failed', 'refunded'].includes(item.state));
  const canAct = Boolean(model && entitlements?.available && !busy && (quote?.affordable !== false)
    && (customMode ? String(custom.draft.styles || '').trim() && sunoCustomReady({ model, draft: custom.draft, controls }) : String(prompt || '').trim()));

  return {
    suno: active && sunoModels.length > 0,
    model, availableModels: sunoModels, offerId, selectOffer,
    customMode, setCustom, custom, controls: effectiveControls, updateControl, updateDraft,
    quote, busy, error: server.error, errorCode: server.errorCode, action, canAct,
    sending: Boolean(busy), jobKind: 'audio',
    generations, generating,
    clearJobs: server.clearGenerations,
    balance: entitlements?.balance ?? null,
    cost: quote?.total_credits ?? model?.total_credits ?? null,
    promptMax: sunoLimit(model, 'prompt'),
    loading: active && entitlements === null && !server.error,
    resolved: entitlements !== null || Boolean(server.error),
    reload: server.reload,
  };
}
