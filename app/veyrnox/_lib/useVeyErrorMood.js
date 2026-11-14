'use client';
import { useEffect } from 'react';
import { signalVeyMood, veyErrorSituation } from '../../../lib/veyMood.js';

// A studio that refuses a submit (no credits, a prompt refused on safety grounds) calls this with the error's code so
// Vey's face follows it. Job results are handled in jobHistory.markJobSettled; this is for errors shown before a job exists.
export default function useVeyErrorMood(code) {
  useEffect(() => {
    const situation = veyErrorSituation(code);
    if (situation) signalVeyMood(situation);
  }, [code]);
}
