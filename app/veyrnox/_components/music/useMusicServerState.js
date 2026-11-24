'use client';

import { useMusicCelebrations } from '../../_lib/useMusicCelebrations';
import { createQuoteGate } from '../../../../lib/quoteRevisionGate.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch, makeIdempotencyKey, notifyBalanceChanged } from '../../_lib/gateway';

const TERMINAL_STATES = new Set(['succeeded', 'partial', 'failed', 'refunded']);
const REQUOTE_ERRORS = new Set(['quote_expired', 'quote_stale', 'quote_already_used', 'contract_stale', 'draft_stale', 'daily_allowance_stale']);
const settleRender = () => new Promise((resolve) => setTimeout(resolve, 0));

function normalizedCode(error) {
  return String(error?.code || error?.message || 'unknown').toLowerCase();
}

export function musicServerError(error) {
  const code = normalizedCode(error);
  const copy = {
    no_token: 'Sign in to load your Music balance and models.',
    unauthenticated: 'Your session ended. Sign in again to continue.',
    account_changed: 'Your account changed. Reload Music before confirming a quote.',
    music_unavailable: 'Server generation is paused. No credits were spent.',
    prompt_not_allowed: 'That direction cannot be used. Try a different musical description.',
    insufficient_balance: 'You do not have enough spendable credits for both versions.',
    quote_expired: 'That quote expired. Review a new quote before creating.',
    quote_stale: 'The model price changed. Review the refreshed quote before creating.',
    daily_allowance_stale: 'Your daily allowance changed. Review the price again before creating.',
    contract_stale: 'contract_stale',
    draft_stale: 'draft_stale',
    quote_already_used: 'That quote was already used. Review a new quote to create again.',
    pair_acceptance_unknown: 'We could not confirm the result. Retry safely with the same request key.',
    network_error: 'The network is unavailable. Your quote has not been confirmed.',
    rate_limited: 'Music is receiving too many requests. Wait a moment and try again.',
    concurrency_limit: 'Four shared Music requests are already active. Let one finish before confirming another.',
  };
  return copy[code] || 'Music is temporarily unavailable. No new request was confirmed.';
}

export function useMusicServerState({ active = true } = {}) {
  const [entitlements, setEntitlements] = useState(null);
  const [quote, setQuote] = useState(null);
  const [generations, setGenerations] = useState([]);
  const registerCelebration = useMusicCelebrations(generations);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const confirmKey = useRef(null);
  const confirming = useRef(false);
  const lastQuoteRequest = useRef(null);
  // A quote response that arrives after the input changed is discarded instead
  // of restoring a quote for text the person no longer has.
  const [gate] = useState(createQuoteGate);
  const pollingError = useRef('');
  const generationReads = useRef(new Map());

  const readGeneration = useCallback(async (id) => {
    const sequence = (generationReads.current.get(id) || 0) + 1;
    generationReads.current.set(id, sequence);
    const next = await gatewayFetch(`/music/generations/${id}`, { promptOnAuth: false });
    return { id, next, sequence };
  }, []);

  const applyGeneration = useCallback(({ id, next, sequence }) => {
    if (generationReads.current.get(id) !== sequence) return false;
    setGenerations((current) => current.map((item) => item.id === id
      ? { ...item, ...next, title: next.title || item.title }
      : item));
    return true;
  }, []);

  const refreshGeneration = useCallback(async (id) => {
    // A confirmed mutation owns these refreshes even if a routine poll later
    // supersedes its generation read or that read hits a transient failure.
    notifyBalanceChanged();
    void gatewayFetch('/music/entitlements', { promptOnAuth: false })
      .then((next) => setEntitlements(next))
      .catch(() => {});
    const generation = await readGeneration(id);
    if (!applyGeneration(generation)) return null;
    return generation.next;
  }, [applyGeneration, readGeneration]);

  const loadEntitlements = useCallback(async () => {
    setBusy('loading');
    setError('');
    setErrorCode('');
    try {
      const next = await gatewayFetch('/music/entitlements');
      setEntitlements(next);
      return next;
    } catch (reason) {
      setErrorCode(reason?.code || 'unknown');
      setError(musicServerError(reason));
      return null;
    } finally {
      setBusy('');
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setTimeout(loadEntitlements, 0);
    return () => window.clearTimeout(timer);
  }, [active, loadEntitlements]);

  const clearQuote = useCallback(() => {
    gate.invalidate();
    setQuote(null);
    confirmKey.current = null;
    lastQuoteRequest.current = null;
  }, [gate]);

  const quoteRevisionNow = useCallback(() => gate.current(), [gate]);
  const clearGenerations = useCallback(() => setGenerations([]), []);

  // `startedAt` is the revision captured before slow preparation (for example a
  // draft save); if anything invalidated the quote meanwhile, do not request one.
  const reviewQuote = useCallback(async (request, startedAt, onContractStale) => {
    if (startedAt !== undefined && !gate.unchanged(startedAt)) return null;
    let mine = gate.start();
    setBusy('quoting');
    setError('');
    setErrorCode('');
    setQuote(null);
    confirmKey.current = null;
    try {
      const capableRequest = entitlements?.daily_allowance?.enabled === true
        ? { ...request, daily_allowance_capable: true } : request;
      const next = await gatewayFetch('/music/generation-quotes', {
        method: 'POST',
        body: JSON.stringify(capableRequest),
      });
      if (!gate.isCurrent(mine)) return null;
      setQuote(next);
      lastQuoteRequest.current = { request: capableRequest, refresh: onContractStale };
      return next;
    } catch (reason) {
      if (gate.isCurrent(mine)) {
        const code = normalizedCode(reason);
        if (code === 'contract_stale' || code === 'draft_stale' || code === 'quote_stale') {
          const fresh = await loadEntitlements();
          const replacement = await onContractStale?.(fresh);
          if (replacement?.mode) {
            // Draft refresh changes controlled fields whose effects invalidate
            // the old quote revision. Retry only after those effects settle.
            await settleRender();
            mine = gate.start();
            const capableReplacement = fresh?.daily_allowance?.enabled === true
              ? { ...replacement, daily_allowance_capable: true } : replacement;
            try {
              const next = await gatewayFetch('/music/generation-quotes', {
                method: 'POST', body: JSON.stringify(capableReplacement),
              });
              if (!gate.isCurrent(mine)) return null;
              setQuote(next);
              lastQuoteRequest.current = { request: capableReplacement, refresh: onContractStale };
              return next;
            } catch (retryError) {
              setErrorCode(normalizedCode(retryError));
              setError(musicServerError(retryError));
              return null;
            }
          }
        }
        setErrorCode(code);
        setError(musicServerError(reason));
      }
      return null;
    } finally {
      if (gate.isLatestStart(mine)) setBusy('');
    }
  }, [entitlements, gate, loadEntitlements]);

  const confirmQuote = useCallback(async (context = {}) => {
    if (!quote?.quote_id || confirming.current) return null;
    confirming.current = true;
    setBusy('confirming');
    setError('');
    setErrorCode('');
    if (confirmKey.current?.quoteId !== quote.quote_id) {
      confirmKey.current = { quoteId: quote.quote_id, key: makeIdempotencyKey() };
    }
    try {
      const result = await gatewayFetch('/music/generations', {
        method: 'POST',
        body: JSON.stringify({
          quote_id: quote.quote_id,
          idempotency_key: confirmKey.current.key,
          provider_contract: quote.provider_contract,
        }),
      });
      registerCelebration(result, quote.total_credits);
      const accepted = {
        id: result.generation_id,
        state: result.state,
        candidates: result.candidates || [],
        title: context.title || '',
        model_id: quote.model_id,
        created_at: new Date().toISOString(),
      };
      setGenerations((current) => [accepted, ...current.filter((item) => item.id !== accepted.id)]);
      setEntitlements((current) => current ? { ...current, balance: Number(result.balance_after) } : current);
      setQuote(null);
      confirmKey.current = null;
      lastQuoteRequest.current = null;
      notifyBalanceChanged();
      void gatewayFetch('/music/entitlements', { promptOnAuth: false })
        .then((next) => setEntitlements(next))
        .catch(() => {});
      return result;
    } catch (reason) {
      const code = normalizedCode(reason);
      if (REQUOTE_ERRORS.has(code)) {
        const previous = lastQuoteRequest.current;
        setQuote(null);
        confirmKey.current = null;
        if (code === 'quote_stale' || code === 'contract_stale' || code === 'draft_stale') {
          const fresh = await loadEntitlements();
          const replacement = await (context.onContractStale || previous?.refresh)?.(fresh);
          if (replacement?.mode) {
            await settleRender();
            await reviewQuote(replacement, undefined, previous?.refresh);
          }
        } else if (code === 'daily_allowance_stale') {
          await loadEntitlements();
        }
      }
      setErrorCode(code);
      setError(musicServerError(reason));
      return null;
    } finally {
      confirming.current = false;
      setBusy('');
    }
  }, [loadEntitlements, quote, registerCelebration, reviewQuote]);

  const activeGenerationKey = generations
    .filter((item) => item?.id && !TERMINAL_STATES.has(item.state))
    .map((item) => item.id)
    .sort()
    .join('|');

  useEffect(() => {
    if (!activeGenerationKey) return undefined;
    let stopped = false;
    let timer;
    const poll = async () => {
      const ids = activeGenerationKey.split('|');
      const reads = await Promise.all(ids.map(async (id) => {
        try {
          return await readGeneration(id);
        } catch (reason) {
          return { id, reason };
        }
      }));
      if (stopped) return;
      const failure = reads.find((item) => item.reason);
      const finished = reads.some((item) => item.next && TERMINAL_STATES.has(item.next.state));
      reads.filter((item) => item.next).forEach(applyGeneration);
      if (failure) {
        pollingError.current = musicServerError(failure.reason);
        setError(pollingError.current);
      } else {
        const recoveredError = pollingError.current;
        setError((current) => current === recoveredError ? '' : current);
        pollingError.current = '';
      }
      if (finished) notifyBalanceChanged();
      if (reads.some((item) => item.reason || !TERMINAL_STATES.has(item.next?.state))) {
        timer = window.setTimeout(poll, 1800);
      }
    };
    timer = window.setTimeout(poll, 800);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [activeGenerationKey, applyGeneration, readGeneration]);

  return {
    entitlements, quote, generations, busy, error, errorCode, quoteRevisionNow,
    clearQuote, clearGenerations, reviewQuote, confirmQuote, refreshGeneration, reload: loadEntitlements,
  };
}
