'use client';
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_VEY_PLACEMENT, readVeyPlacement, writeVeyPlacement } from '../../../lib/veyPlacement';

export default function useVeyPlacement() {
  // null keeps server/client initial rendering identical and prevents defaults
  // overwriting a saved placement before the browser preference has been read.
  const [placement, setPlacement] = useState(null);
  useEffect(() => {
    let saved = DEFAULT_VEY_PLACEMENT;
    try { saved = readVeyPlacement(window.localStorage); } catch { /* Storage may be disabled. */ }
    setPlacement(current => current || saved);
  }, []);
  useEffect(() => {
    if (!placement) return;
    try { writeVeyPlacement(window.localStorage, placement); } catch { /* Movement still works without storage. */ }
  }, [placement]);
  const setManualPosition = useCallback(position => setPlacement(current => ({ ...(current || DEFAULT_VEY_PLACEMENT), position })), []);
  const movePanels = useCallback(() => setPlacement(current => {
    const previous = current || DEFAULT_VEY_PLACEMENT;
    return { ...previous, side: previous.side === 'left' ? 'right' : 'left' };
  }), []);
  const resetPosition = useCallback(() => setManualPosition(null), [setManualPosition]);
  const current = placement || DEFAULT_VEY_PLACEMENT;
  return { manualPosition: current.position, panelSide: current.side, setManualPosition, movePanels, resetPosition };
}
