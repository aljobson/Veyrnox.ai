'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getStoredUserId, onSessionChange } from '../../lib/authClient';
import { fetchRemoteAnswers, readDeviceAnswers, saveDeviceAnswers } from './firstProfileSync';

/**
 * What this person told us in the first-run questions: { ready, signedIn, goal, role, destination }. `ready` is false
 * until the account has been asked (when it can be) so a screen never flashes the wrong order. The account's words win
 * and are copied to this browser; when the server cannot be asked the device copy decides. Asked again on sign-in.
 */
export function useFirstProfile() {
  const userId = useSyncExternalStore(onSessionChange, getStoredUserId, () => null);
  const [state, setState] = useState({ ready: false, goal: null, role: null, destination: null });
  useEffect(() => {
    let alive = true;
    const device = readDeviceAnswers();
    fetchRemoteAnswers().then((remote) => {
      if (!alive) return;
      if (remote.kind !== 'answers') { setState({ ready: true, ...device }); return; }
      // The account's words win, including "none yet": another account's copy on this browser must not answer for this one.
      saveDeviceAnswers(remote);
      setState({ ready: true, goal: remote.goal, role: remote.role, destination: remote.destination });
    });
    return () => { alive = false; };
  }, [userId]);
  return { ...state, signedIn: !!userId };
}
