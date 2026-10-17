'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getStoredUserId, onSessionChange } from '../../lib/authClient';
import { readVeyWorkspace, writeVeyWorkspace } from '../../../lib/createDraftRecovery';

const actorSnapshot = () => getStoredUserId() || 'signed-out';
export default function useVeyWorkspaceSession() {
  const actor = useSyncExternalStore(onSessionChange, actorSnapshot, () => null);
  const [open, setOpen] = useState(false);
  const [chatting, setChatting] = useState(false);
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    if (!actor) return;
    let value = { open: false, chatting: false };
    try { value = readVeyWorkspace(sessionStorage, actor); } catch { /* In-memory helper still works. */ }
    setOpen(value.open); setChatting(value.chatting); setLoaded(actor);
  }, [actor]);
  useEffect(() => {
    if (!actor || loaded !== actor) return;
    try { writeVeyWorkspace(sessionStorage, actor, { open, chatting }); } catch { /* Optional storage. */ }
  }, [actor, loaded, open, chatting]);
  return { open, setOpen, chatting, setChatting };
}
