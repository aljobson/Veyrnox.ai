'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getStoredUserId, onSessionChange } from '../../lib/authClient';
import { onboardingUiComplete } from './firstProfile';
import { fetchRemoteAnswers, readDeviceAnswers, readOfflineOnboarding, saveDeviceAnswers, saveDeviceOnboarding, scheduleOnboardingReplay } from './firstProfileSync';

const REMOTE_DEADLINE_MS = 5000;

/**
 * What this person told us in the first-run questions: { ready, signedIn, goal, role, destination }. `ready` is false
 * until the account has been asked (when it can be) so a screen never flashes the wrong order. The account's words win
 * and are copied to this browser; when the server cannot be asked the device copy decides. Asked again on sign-in.
 */
export function useFirstProfile() {
  const userId = useSyncExternalStore(onSessionChange, getStoredUserId, () => null);
  const [retry, setRetry] = useState(0);
  const failures = useRef(0);
  const previousUser = useRef(null);
  const [state, setState] = useState({ ready: false, unresolved: true, goal: null, role: null, destination: null, version: null, currentStep: null, completed: undefined, uiComplete: false });
  useEffect(() => {
    if (previousUser.current !== userId) { previousUser.current = userId; failures.current = 0; }
    let alive = true;
    let retryTimer;
    let deadlineTimer;
    const deadline = new Promise((resolve) => {
      deadlineTimer = setTimeout(() => resolve({ kind: 'unavailable' }), REMOTE_DEADLINE_MS);
    });
    Promise.race([fetchRemoteAnswers(), deadline]).then((remote) => {
      clearTimeout(deadlineTimer);
      if (!alive) return;
      const offline = readOfflineOnboarding(userId);
      if (remote.kind !== 'answers') {
        if (offline.kind === 'answers') {
          setState({ ready: true, unresolved: false, goal: offline.goal, role: offline.role, destination: offline.destination,
            version: offline.version, currentStep: offline.currentStep, completed: offline.completed, uiComplete: onboardingUiComplete(offline) });
          if (offline.pending) void scheduleOnboardingReplay(userId, offline).then((settled) => {
            if (alive && settled && !settled.pending) setState({ ready: true, unresolved: false, ...settled, uiComplete: onboardingUiComplete(settled) });
          });
        }
        else if (offline.kind === 'signed-out') {
          const device = readDeviceAnswers();
          setState({ ready: true, unresolved: false, ...device, version: null, currentStep: null, completed: undefined, uiComplete: false });
        }
        else if (++failures.current <= 3) {
          // Ownerless legacy slots are unsafe, but that must not freeze Home. Use neutral ordering while the
          // account remains explicitly unresolved, retry a few times, and let an online event try again later.
          setState({ ready: true, unresolved: true, goal: null, role: null, destination: null, version: null, currentStep: null, completed: undefined, uiComplete: false });
          retryTimer = setTimeout(() => { if (alive) setRetry((attempt) => attempt + 1); }, 1500 * failures.current);
        }
        else setState({ ready: true, unresolved: true, goal: null, role: null, destination: null, version: null, currentStep: null, completed: undefined, uiComplete: false });
        return;
      }
      failures.current = 0;
      if (offline.kind === 'answers' && offline.pending && remote.completed !== true) {
        setState({ ready: true, unresolved: false, goal: offline.goal, role: offline.role, destination: offline.destination,
          version: offline.version, currentStep: offline.currentStep, completed: offline.completed, uiComplete: onboardingUiComplete(offline) });
        void scheduleOnboardingReplay(userId, offline).then((settled) => {
          if (alive && settled && !settled.pending) setState({ ready: true, unresolved: false, ...settled, uiComplete: onboardingUiComplete(settled) });
        });
        return;
      }
      // The account's words win, including "none yet": another account's copy on this browser must not answer for this one.
      saveDeviceAnswers(remote);
      const next = { ready: true, unresolved: false, goal: remote.goal, role: remote.role, destination: remote.destination,
        version: remote.version ?? null, currentStep: remote.currentStep ?? null,
        completed: typeof remote.completed === 'boolean' ? remote.completed : !(remote.goal === null && remote.role === null),
        uiComplete: typeof remote.completed === 'boolean' ? remote.completed : !(remote.goal === null && remote.role === null) };
      if (userId && remote.version !== undefined) saveDeviceOnboarding(userId, next);
      setState(next);
    });
    return () => { alive = false; clearTimeout(deadlineTimer); clearTimeout(retryTimer); };
  }, [retry, userId]);
  useEffect(() => {
    const retryNow = () => { failures.current = 0; setRetry((attempt) => attempt + 1); };
    const visible = () => { if (document.visibilityState === 'visible') retryNow(); };
    window.addEventListener('online', retryNow);
    document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('online', retryNow); document.removeEventListener('visibilitychange', visible); };
  }, []);
  return { ...state, signedIn: !!userId, userId };
}
