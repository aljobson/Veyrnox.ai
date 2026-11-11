'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';

function libraryError(error) {
  const copy = {
    no_token: 'Sign in to open your private Music Library.',
    unauthenticated: 'Your session ended. Sign in again to reload your Library.',
    music_library_unavailable: 'Private Music organization is paused. Nothing was moved.',
    name_taken: 'A workspace with that name already exists.',
    limit_reached: 'You have reached the private workspace limit.',
    revision_conflict: 'The Library changed in another tab. Reload before moving these songs.',
    not_found: 'One selected song or workspace is no longer available. Reload the Library.',
    network_error: 'The Library could not reach the server. Your selection remains here.',
  };
  return copy[error?.code] || 'The private Music Library is temporarily unavailable.';
}

export function useMusicLibraryState() {
  const [workspaces, setWorkspaces] = useState([]);
  const [songs, setSongs] = useState([]);
  const [trashedSongs, setTrashedSongs] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashLoaded, setTrashLoaded] = useState(false);
  const createLock = useRef(false);
  const createAttempt = useRef(null);
  const moveLock = useRef(false);
  const moveAttempt = useRef(null);
  const feedbackLocks = useRef(new Set());
  const lifecycleLocks = useRef(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [workspaceResult, songResult] = await Promise.all([
        gatewayFetch('/music/workspaces'),
        gatewayFetch('/music/songs?limit=50'),
      ]);
      setWorkspaces(workspaceResult.workspaces || []);
      setSongs(songResult.songs || []);
      setSelectedIds((current) => current.filter((id) => (songResult.songs || []).some((song) => song.id === id)));
    } catch (reason) {
      setError(libraryError(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTrash = useCallback(async () => {
    if (trashLoading) return;
    setTrashLoading(true);
    setError('');
    try {
      const result = await gatewayFetch('/music/songs?limit=50&collection=trash');
      setTrashedSongs(result.songs || []);
      setTrashLoaded(true);
    } catch (reason) {
      setError(libraryError(reason));
    } finally {
      setTrashLoading(false);
    }
  }, [trashLoading]);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectedSongs = useMemo(
    () => songs.filter((song) => selectedIds.includes(song.id)),
    [selectedIds, songs],
  );

  const toggle = useCallback((id) => {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  }, []);

  const selectVisible = useCallback((ids) => {
    setSelectedIds((current) => {
      const visible = new Set(ids);
      const everySelected = ids.length > 0 && ids.every((id) => current.includes(id));
      if (everySelected) return current.filter((id) => !visible.has(id));
      return [...new Set([...current, ...ids])];
    });
  }, []);

  const createWorkspace = useCallback(async (name) => {
    if (createLock.current) return null;
    createLock.current = true;
    const prior = createAttempt.current;
    const idempotencyKey = prior?.name === name
      ? prior.idempotencyKey
      : `workspace.${globalThis.crypto.randomUUID()}`;
    createAttempt.current = { name, idempotencyKey };
    setBusy('creating');
    setError('');
    try {
      const result = await gatewayFetch('/music/workspaces', {
        method: 'POST',
        body: JSON.stringify({
          name,
          idempotency_key: idempotencyKey,
        }),
      });
      createAttempt.current = null;
      setWorkspaces((current) => [...current.filter((item) => item.id !== result.workspace.id), result.workspace].sort((a, b) => {
        if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
        return a.name.localeCompare(b.name);
      }));
      return result.workspace;
    } catch (reason) {
      if (!['network_error', 'gateway_error', 'temporarily_unavailable'].includes(reason?.code)) {
        createAttempt.current = null;
      }
      setError(libraryError(reason));
      return null;
    } finally {
      createLock.current = false;
      setBusy('');
    }
  }, []);

  const moveSelected = useCallback(async (destinationWorkspaceId) => {
    if (!selectedSongs.length || moveLock.current) return false;
    moveLock.current = true;
    const items = selectedSongs.map((song) => ({ id: song.id, revision: song.revision }));
    const fingerprint = JSON.stringify({ destinationWorkspaceId, items });
    const prior = moveAttempt.current;
    const idempotencyKey = prior?.fingerprint === fingerprint
      ? prior.idempotencyKey
      : `move.${globalThis.crypto.randomUUID()}`;
    moveAttempt.current = { fingerprint, idempotencyKey };
    setBusy('moving');
    setError('');
    try {
      const result = await gatewayFetch('/music/songs/move', {
        method: 'POST',
        body: JSON.stringify({
          destination_workspace_id: destinationWorkspaceId,
          idempotency_key: idempotencyKey,
          songs: items,
        }),
      });
      moveAttempt.current = null;
      const moved = new Map((result.songs || []).map((song) => [song.id, song]));
      const destination = workspaces.find((workspace) => workspace.id === destinationWorkspaceId);
      setSongs((current) => current.map((song) => {
        const update = moved.get(song.id);
        return update ? {
          ...song,
          workspace_id: update.workspace_id,
          workspace_name: destination?.name || song.workspace_name,
          revision: update.revision,
        } : song;
      }));
      setWorkspaces((current) => current.map((workspace) => ({
        ...workspace,
        song_count: songs.reduce((count, song) => {
          const update = moved.get(song.id);
          const workspaceId = update?.workspace_id || song.workspace_id;
          return count + (workspaceId === workspace.id ? 1 : 0);
        }, 0),
      })));
      setSelectedIds([]);
      return true;
    } catch (reason) {
      if (!['network_error', 'gateway_error', 'temporarily_unavailable'].includes(reason?.code)) {
        moveAttempt.current = null;
      }
      setError(libraryError(reason));
      return false;
    } finally {
      moveLock.current = false;
      setBusy('');
    }
  }, [selectedSongs, songs, workspaces]);

  const setFeedback = useCallback(async (songId, value) => {
    if (feedbackLocks.current.has(songId)) return false;
    feedbackLocks.current.add(songId);
    setError('');
    try {
      const result = await gatewayFetch(`/music/songs/${songId}/feedback`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      });
      setSongs((current) => current.map((song) => (song.id === songId
        ? { ...song, feedback: result.feedback }
        : song)));
      return true;
    } catch (reason) {
      setError(libraryError(reason));
      return false;
    } finally {
      feedbackLocks.current.delete(songId);
    }
  }, []);

  const setSongLifecycle = useCallback(async (song, action) => {
    if (!song?.id || lifecycleLocks.current.has(song.id)) return false;
    lifecycleLocks.current.add(song.id);
    setBusy(`${action}:${song.id}`);
    setError('');
    try {
      const result = await gatewayFetch(`/music/songs/${song.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, revision: song.revision }),
      });
      const updated = {
        ...song,
        ...result.song,
        lifecycle_status: action === 'trash' ? 'trashed' : 'active',
      };
      if (action === 'trash') {
        setSongs((current) => current.filter((item) => item.id !== song.id));
        setTrashedSongs((current) => [updated, ...current.filter((item) => item.id !== song.id)]);
        setTrashLoaded(true);
        setSelectedIds((current) => current.filter((id) => id !== song.id));
      } else {
        setTrashedSongs((current) => current.filter((item) => item.id !== song.id));
        setSongs((current) => [updated, ...current.filter((item) => item.id !== song.id)]);
      }
      setWorkspaces((current) => current.map((workspace) => workspace.id === song.workspace_id
        ? { ...workspace, song_count: Math.max(0, workspace.song_count + (action === 'trash' ? -1 : 1)) }
        : workspace));
      return true;
    } catch (reason) {
      setError(libraryError(reason));
      return false;
    } finally {
      lifecycleLocks.current.delete(song.id);
      setBusy('');
    }
  }, []);

  return {
    workspaces, songs, trashedSongs, selectedIds, selectedSongs, loading, trashLoading, trashLoaded, busy, error,
    load, loadTrash, toggle, selectVisible, createWorkspace, moveSelected, setFeedback, setSongLifecycle,
  };
}
