'use client';
import { useRef, useState } from 'react';
import { clampVeyPosition, dragVeyPosition } from '../../../lib/veyPointer';

export default function useVeyDrag({ onMove, onReset, onStart }) {
  const gesture = useRef(null);
  const eatClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const viewport = () => ({ width: innerWidth, height: innerHeight });
  const finish = (event, cancelled = false) => {
    if (gesture.current?.id !== event.pointerId) return;
    eatClick.current = !cancelled && gesture.current.moved;
    gesture.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return { dragging, handlers: {
    onPointerDown(event) {
      if (!event.isPrimary || event.button !== 0) return;
      const r = event.currentTarget.parentElement.getBoundingClientRect();
      eatClick.current = false;
      gesture.current = { id: event.pointerId, pointer: { x: event.clientX, y: event.clientY }, position: { x: r.x, y: r.y }, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event) {
      const start = gesture.current;
      if (!start || start.id !== event.pointerId) return;
      const next = dragVeyPosition(start, { x: event.clientX, y: event.clientY }, viewport());
      if (!next) return;
      if (!start.moved) { start.moved = true; setDragging(true); onStart(); }
      onMove(next);
    },
    onPointerUp: finish,
    onPointerCancel: (event) => finish(event, true),
    onLostPointerCapture: (event) => finish(event, true),
    onClickCapture(event) {
      if (!eatClick.current) return;
      eatClick.current = false;
      event.preventDefault(); event.stopPropagation();
    },
    onKeyDown(event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onReset(); return; }
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!event.altKey || !direction) return;
      event.preventDefault();
      const r = event.currentTarget.parentElement.getBoundingClientRect();
      const distance = event.shiftKey ? 30 : 10;
      onStart(); onMove(clampVeyPosition({ x: r.x + direction[0] * distance, y: r.y + direction[1] * distance }, viewport()));
    },
  } };
}
