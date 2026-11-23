'use client';
import { useCallback, useEffect, useRef } from 'react';
import { getSession } from '../../lib/authClient';
import { settleGenerationResult } from './jobHistory';
import { useResultPresence } from './resultPresence';

export const musicResultId = (generation, candidate) => candidate.job_id || candidate.id || `music:${generation.id}:${candidate.ordinal}`;
// Screen-local: navigate-away completion is excluded; music needs a separate poller after unmount. Reloads/resumed results stay silent.
export function useMusicCelebrations(generations) {
  const accepted = useRef(new Map());
  const submitted = useRef(new Set());
  const ids = generations.flatMap(g => (g.candidates || [{ id: `music:${g.id}`, job_id: g.job_id, state: g.state }]).map(c => musicResultId(g, c)));
  useResultPresence(ids);
  const register = useCallback((result, totalCredits) => {
    const id = result.generation_id || result.request_id;
    if (id && !result.idempotent && !accepted.current.has(id)) accepted.current.set(id, { owner: getSession()?.user?.id, submitted_at: Date.now(), totalCredits, spendOffered: false });
  }, []);
  // Serialize only eligible result facts: new polling arrays with the same
  // candidates do not restart this effect or repeatedly request a shared claim.
  const readyKey = JSON.stringify(generations.flatMap(g => {
    if (['failed', 'refunded', 'cancelled'].includes(g.state)) return [];
    return (g.candidates || [{ id: `music:${g.id}`, job_id: g.job_id, state: g.state }])
      .filter(c => ['ready', 'succeeded'].includes(c.state) && !c.refunded)
      .map(c => ({ generationId: g.id, id: musicResultId(g, c), name: g.title }));
  }));
  useEffect(() => {
    for (const result of JSON.parse(readyKey)) {
      const submission = accepted.current.get(result.generationId);
      if (!submission || submitted.current.has(result.id)) continue;
      submitted.current.add(result.id);
      // A quote covers the whole generation, even when it returns several candidates.
      const credits = submission.spendOffered ? undefined : submission.totalCredits;
      submission.spendOffered = true;
      void settleGenerationResult({ job_id: result.id, submitted_at: submission.submitted_at, name: result.name, credits }, submission.owner);
    }
  }, [readyKey]);
  return register;
}
