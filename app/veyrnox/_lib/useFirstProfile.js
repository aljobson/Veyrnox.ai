'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getStoredUserId, onSessionChange } from '../../lib/authClient';
import { fetchRemoteAnswers, readOfflineOnboarding, saveDeviceAnswers, saveDeviceOnboarding } from './firstProfileSync';

/**
 * What this person told us in the first-run questions: { ready, signedIn, goal, role, destination }. `ready` is false
 * until the account has been asked (when it can be) so a screen never flashes the wrong order. The account's words win
 * and are copied to this browser; when the server cannot be asked the device copy decides. Asked again on sign-in.
 */
export function useFirstProfile() {
  const userId = useSyncExternalStore(onSessionChange, getStoredUserId, () => null);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({ ready: false, unresolved: true, goal: null, role: null, destination: null, version: null, currentStep: null, completed: undefined });
  useEffect(() => {
    let alive = true;
    let retryTimer;
    fetchRemoteAnswers().then((remote) => {
      if (!alive) return;
      if (remote.kind !== 'answers') {
        const offline = readOfflineOnboarding(userId);
        if (offline.kind === 'answers') {
          setState({ ready: true, unresolved: false, goal: offline.goal, role: offline.role, destination: offline.destination,
            version: offline.version, currentStep: offline.currentStep, completed: offline.completed });
        }
        else if (offline.kind === 'signed-out') setState({ ready: true, unresolved: false, goal: null, role: null, destination: null, version: null, currentStep: null, completed: undefined });
        else {
          setState({ ready: false, unresolved: true, goal: null, role: null, destination: null, version: null, currentStep: null, completed: undefined });
          retryTimer = setTimeout(() => { if (alive) setRetry((attempt) => attempt + 1); }, Math.min(15000, 2000 * (retry + 1)));
        }
        return;
      }
      // The account's words win, including "none yet": another account's copy on this browser must not answer for this one.
      saveDeviceAnswers(remote);
      const next = { ready: true, unresolved: false, goal: remote.goal, role: remote.role, destination: remote.destination,
        version: remote.version ?? null, currentStep: remote.currentStep ?? null,
        completed: typeof remote.completed === 'boolean' ? remote.completed : !(remote.goal === null && remote.role === null) };
      if (userId && remote.version !== undefined) saveDeviceOnboarding(userId, next);
      setState(next);
    });
    return () => { alive = false; clearTimeout(retryTimer); };
  }, [retry, userId]);
  return { ...state, signedIn: !!userId, userId };
}
