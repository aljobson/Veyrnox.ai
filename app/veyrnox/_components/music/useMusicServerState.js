'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch, makeIdempotencyKey, notifyBalanceChanged } from '../../_lib/gateway';

const TERMINAL_STATES = new Set(['succeeded', 'partial', 'failed', 'refunded']);
const REQUOTE_ERRORS = new Set(['quote_expired', 'quote_stale', 'quote_already_used']);

export function musicServerError(error) {
  const code = error?.code || error?.message;
  const copy = {
    no_token: 'Sign in to load your Music balance and models.',
    unauthenticated: 'Your session ended. Sign in again to continue.',
    account_changed: 'Your account changed. Reload Music before confirming a quote.',
    music_unavailable: 'Server generation is paused. No credits were spent.',
    prompt_not_allowed: 'That direction cannot be used. Try a different musical description.',
    insufficient_balance: 'You do not have enough spendable credits for both versions.',
    quote_expired: 'That quote expired. Review a new quote before creating.',
    quote_stale: 'The model price changed. Review the refreshed quote before creating.',
    quote_already_used: 'That quote was already used. Review a new quote to create again.',
    pair_acceptance_unknown: 'We could not confirm the result. Retry safely with the same request key.',
    network_error: 'The network is unavailable. Your quote has not been confirmed.',
    rate_limited: 'Music is receiving too many requests. Wait a moment and try again.',
    concurrency_limit: 'Four shared Music requests are already active. Let one finish before confirming another.',
  };
  return copy[code] || 'Music is temporarily unavailable. No new request was confirmed.';
}

export function useMusicServerState() {
  const [entitlements, setEntitlements] = useState(null);
  const [quote, setQuote] = useState(null);
  const [generations, setGenerations] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const confirmKey = useRef(null);
  const confirming = useRef(false);
  // Advances whenever a quote is requested or cleared, so a quote response that
  // arrives after the input changed is discarded instead of restoring a quote
  // for text the person no longer has.
  const quoteRevision = useRef(0);
  const lastQuoteRequest = useRef(0);
  const pollingError = useRef('');

  const loadEntitlements = useCallback(async () => {
    setBusy('loading');
    setError('');
    try {
      setEntitlements(await gatewayFetch('/music/entitlements'));
    } catch (reason) {
      setError(musicServerError(reason));
    } finally {
      setBusy('');
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(loadEntitlements, 0);
    return () => window.clearTimeout(timer);
  }, [loadEntitlements]);

  const clearQuote = useCallback(() => {
    quoteRevision.current += 1;
    setQuote(null);
    confirmKey.current = null;
  }, []);

  const reviewQuote = useCallback(async (request) => {
    const mine = quoteRevision.current + 1;
    quoteRevision.current = mine;
    lastQuoteRequest.current = mine;
    setBusy('quoting');
    setError('');
    setQuote(null);
    confirmKey.current = null;
    try {
      const next = await gatewayFetch('/music/generation-quotes', {
        method: 'POST',
        body: JSON.stringify(request),
      });
      if (quoteRevision.current !== mine) return null;
      setQuote(next);
      return next;
    } catch (reason) {
      if (quoteRevision.current === mine) setError(musicServerError(reason));
      return null;
    } finally {
      if (lastQuoteRequest.current === mine) setBusy('');
    }
  }, []);

  const confirmQuote = useCallback(async (context = {}) => {
    if (!quote?.quote_id || confirming.current) return null;
    confirming.current = true;
    setBusy('confirming');
    setError('');
    if (confirmKey.current?.quoteId !== quote.quote_id) {
      confirmKey.current = { quoteId: quote.quote_id, key: makeIdempotencyKey() };
    }
    try {
      const result = await gatewayFetch('/music/generations', {
        method: 'POST',
        body: JSON.stringify({
          quote_id: quote.quote_id,
          idempotency_key: confirmKey.current.key,
        }),
      });
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
      notifyBalanceChanged();
      return result;
    } catch (reason) {
      if (REQUOTE_ERRORS.has(reason?.code)) {
        setQuote(null);
        confirmKey.current = null;
      }
      setError(musicServerError(reason));
      return null;
    } finally {
      confirming.current = false;
      setBusy('');
    }
  }, [quote]);

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
          return { id, next: await gatewayFetch(`/music/generations/${id}`, { promptOnAuth: false }) };
        } catch (reason) {
          return { id, reason };
        }
      }));
      if (stopped) return;
      const updates = new Map(reads.filter((item) => item.next).map((item) => [item.id, item.next]));
      const failure = reads.find((item) => item.reason);
      const finished = reads.some((item) => item.next && TERMINAL_STATES.has(item.next.state));
      setGenerations((current) => current.map((item) => updates.has(item.id)
        ? { ...item, ...updates.get(item.id), title: updates.get(item.id).title || item.title }
        : item));
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
  }, [activeGenerationKey]);

  return {
    entitlements, quote, generations, busy, error,
    clearQuote, reviewQuote, confirmQuote, reload: loadEntitlements,
  };
}
