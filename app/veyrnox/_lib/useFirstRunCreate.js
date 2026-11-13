'use client';
import { useEffect, useRef } from 'react';
import { nearestOption } from '../../../lib/aspectShapes.mjs';
import { defaultAspectFor, exampleSetFor } from './firstProfile';
import { takeFirstRunHandoff } from './firstProfileSync';
import { useFirstProfile } from './useFirstProfile';

const FORM_DEFAULT_ASPECT = '16:9';

/**
 * What the first-run answers (ADR-0339) do on Create, once each:
 *  - a goal chosen in the first-run flow picks that kind and fills one example prompt (work examples for creator,
 *    business and pro, the everyday ones otherwise);
 *  - the destination sets the starting aspect ratio (9:16 for TikTok and Reels, 16:9 for YouTube) while the form still
 *    holds its own default. The person can change either at once.
 * `blocked` is true while a preset, template or scene already decided the form.
 */
export function useFirstRunCreate({ t, blocked, catalogLoading, pickGoal, setPrompt, aspect, aspectOptions, setAspect }) {
  const profile = useFirstProfile();
  const handoffDone = useRef(false);
  const aspectDone = useRef(false);

  useEffect(() => {
    if (!profile.ready || catalogLoading || blocked || handoffDone.current) return;
    handoffDone.current = true;
    const goal = takeFirstRunHandoff();
    if (!goal) return;
    pickGoal(goal);
    setPrompt(t(exampleSetFor(profile.role) === 'work' ? `app.create.firstRun.example.work.${goal}` : `app.create.firstGoal.example.${goal}`));
  }, [profile.ready, catalogLoading, blocked]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!profile.ready || catalogLoading || blocked || aspectDone.current) return;
    const wanted = defaultAspectFor(profile.destination);
    if (!wanted) { aspectDone.current = true; return; }
    if (!aspectOptions.length) return; // this model has no aspect choice yet: wait for one that does
    aspectDone.current = true;
    if (aspect !== FORM_DEFAULT_ASPECT) return;
    const next = aspectOptions.includes(wanted) ? wanted : nearestOption(wanted, aspectOptions);
    if (next) setAspect(next);
  }, [profile.ready, profile.destination, catalogLoading, blocked, aspectOptions.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  return profile;
}
