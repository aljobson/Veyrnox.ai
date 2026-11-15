'use client';
import { useEffect, useRef, useState } from 'react';
import { snapTick } from '../../../_lib/music/beat/beatTime.mjs';
import * as ops from '../../../_lib/music/beat/beatOps.mjs';

export default function useRegionDrag({ scroller, zoom, snap, edit, announce }) {
  const active = useRef(null);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    function cancel() {
      if (!active.current) return;
      active.current = null; setPreview(null); suppressClick.current = true;
      announce('Drag cancelled');
    }
    function move(event) {
      const drag = active.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.x + scroller.current.scrollLeft - drag.scroll;
      if (!drag.moved && Math.hypot(dx, event.clientY - drag.y) < 4) return;
      drag.moved = true;
      const delta = dx * 3840 / zoom;
      const { region, mode } = drag;
      let trackId = drag.trackId;
      if (mode === 'move') {
        const lanes = scroller.current.querySelectorAll('[data-track-lane]');
        for (const lane of lanes) {
          const rect = lane.getBoundingClientRect();
          if (event.clientY >= rect.top && event.clientY < rect.bottom) trackId = lane.dataset.trackLane;
        }
      }
      const start = mode === 'resize' ? region.start : Math.max(0, snapTick(region.start + delta, snap));
      const end = mode === 'resize' ? Math.max(region.start + 240, snapTick(region.start + region.length + delta, snap))
        : region.start + region.length;
      const value = { ...region, start: mode === 'trim' ? Math.min(start, end - 240) : start,
        length: mode === 'move' ? region.length : end - (mode === 'trim' ? Math.min(start, end - 240) : start),
        trackId, copy: drag.copy };
      drag.value = value;
      setPreview(value);
    }
    function end(event) {
      const drag = active.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      active.current = null; setPreview(null);
      if (!drag.moved) return;
      suppressClick.current = true;
      const { value, mode, region, copy } = drag;
      const label = mode === 'move' ? (copy ? 'copy region' : 'move region') : mode === 'trim' ? 'trim region' : 'resize region';
      edit((d) => mode === 'resize' ? ops.resizeRegion(d, region.id, value.length)
        : mode === 'trim' ? ops.trimRegionStart(d, region.id, value.start)
          : (copy ? ops.copyRegion : ops.moveRegion)(d, region.id, value.start, value.trackId),
      { label, message: `${mode === 'move' ? (copy ? 'Copied' : 'Moved') : 'Edited'} to bar ${value.start / 3840 + 1}` });
    }
    function key(event) { if (event.key === 'Escape' && active.current) { event.preventDefault(); cancel(); } }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
    };
  }, [scroller, zoom, snap, edit, announce]);
  function begin(event, region, trackId, mode = 'move') {
    if (event.button !== 0) return;
    event.stopPropagation();
    suppressClick.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    active.current = { region, trackId, mode, copy: event.altKey && mode === 'move',
      pointerId: event.pointerId, x: event.clientX, y: event.clientY, scroll: scroller.current.scrollLeft, moved: false };
  }
  function consumeClick() {
    const suppressed = suppressClick.current;
    suppressClick.current = false;
    return suppressed;
  }
  return { preview, begin, consumeClick };
}
