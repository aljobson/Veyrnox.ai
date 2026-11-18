'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { swapStore, connectSwapSession } from './templateSwapRuntime.js';
const serverRevision = () => 0;
export function useSwapDraft(id) {
  useSyncExternalStore(swapStore.subscribe, swapStore.revision, serverRevision);
  useEffect(() => { connectSwapSession(); }, []);
  return { accountId: swapStore.owner(), attempts: swapStore.get(id) };
}
