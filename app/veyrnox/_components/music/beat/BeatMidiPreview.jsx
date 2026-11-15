'use client';
import { useEffect, useRef } from 'react';
export default function BeatMidiPreview({ clip }) {
  const canvas = useRef(null);
  useEffect(() => {
    const c = canvas.current, ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height); ctx.fillStyle = getComputedStyle(c).color;
    const low = Math.min(48, ...clip.notes.map((n) => n[2])), high = Math.max(72, ...clip.notes.map((n) => n[2]));
    for (const [start, length, pitch] of clip.notes) ctx.fillRect(start / clip.lengthTicks * c.width, (high - pitch) / (high - low + 1) * c.height, Math.max(1, length / clip.lengthTicks * c.width), 2);
  }, [clip]);
  return <><span>{clip.name}</span><canvas ref={canvas} width={256} height={30} className="h-8 w-full text-vx-fg" aria-hidden="true" /></>;
}
