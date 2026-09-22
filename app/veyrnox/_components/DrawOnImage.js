'use client';
import { useEffect, useRef, useState } from 'react';

// Draw-to-edit: sketch over the start image, then hand back one flattened PNG
// that replaces it. The edit model reads the marks as instructions, so no
// mask or second upload is needed. Idea from Open-Generative-AI's
// DrawModal.jsx (MIT, Copyright (c) Anil Matcha); pencil only.

const COLORS = ['#eab308', '#ef4444', '#ffffff', '#22d3ee'];
// Long side of the flattened image. Keeps the PNG well under the 20 MB cap.
const MAX_SIDE = 2048;

export function DrawOnImage({ file, onDone, onCancel }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const drawing = useRef(null);
  const [strokes, setStrokes] = useState([]);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(8);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const c = canvasRef.current;
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      imgRef.current = img;
      setReady(true);
    };
    img.src = url;
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => { URL.revokeObjectURL(url); window.removeEventListener('keydown', onKey); };
  }, [file, onCancel]);

  useEffect(() => {
    if (!ready) return;
    const c = canvasRef.current;
    const ctx = c.getContext('2d');
    ctx.drawImage(imgRef.current, 0, 0, c.width, c.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.size;
      ctx.beginPath();
      s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (s.points.length === 1) ctx.lineTo(s.points[0][0] + 0.1, s.points[0][1]);
      ctx.stroke();
    }
  }, [strokes, ready]);

  // Pointer position in canvas pixels; the canvas is shown scaled down.
  function point(e) {
    const r = canvasRef.current.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvasRef.current.width / r.width),
      (e.clientY - r.top) * (canvasRef.current.height / r.height)];
  }
  function down(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const scaled = size * (canvasRef.current.width / canvasRef.current.getBoundingClientRect().width);
    drawing.current = { color, size: scaled, points: [point(e)] };
    setStrokes((s) => [...s, drawing.current]);
  }
  function move(e) {
    if (!drawing.current) return;
    const stroke = { ...drawing.current, points: [...drawing.current.points, point(e)] };
    drawing.current = stroke;
    setStrokes((s) => [...s.slice(0, -1), stroke]);
  }
  function up() { drawing.current = null; }

  function done() {
    canvasRef.current.toBlob((blob) => {
      if (blob) onDone(new File([blob], 'sketch.png', { type: 'image/png' }));
    }, 'image/png');
  }

  const btn = 'font-vx-mono text-[11px] font-bold rounded-full px-3.5 py-1.5 border border-vx-border text-vx-fg-muted hover:text-vx-fg disabled:opacity-40';
  return (
    <div role="dialog" aria-modal="true" aria-label="Draw on start image"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-4xl rounded-2xl border border-vx-border bg-vx-panel p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted mr-2">DRAW TO EDIT</span>
          {COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} aria-label={`Colour ${c}`} aria-pressed={color === c}
              className={`w-6 h-6 rounded-full border-2 ${color === c ? 'border-vx-accent' : 'border-vx-border'}`}
              style={{ background: c }} />
          ))}
          <label className="flex items-center gap-2 ml-2 text-xs text-vx-fg-muted">
            Size
            <input type="range" min="2" max="40" value={size} onChange={(e) => setSize(Number(e.target.value))} />
          </label>
          <span className="flex-1" />
          <button className={btn} disabled={!strokes.length} onClick={() => setStrokes((s) => s.slice(0, -1))}>Undo</button>
          <button className={btn} disabled={!strokes.length} onClick={() => setStrokes([])}>Clear</button>
        </div>
        <canvas ref={canvasRef}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          className="w-full max-h-[65vh] object-contain rounded-lg bg-black touch-none cursor-crosshair" />
        <div className="text-xs text-vx-fg-muted">
          Mark what to change, then describe it in the prompt, e.g. “replace the yellow scribble with a red sailboat”.
        </div>
        <div className="flex justify-end gap-2">
          <button className={btn} onClick={onCancel}>Cancel</button>
          <button onClick={done} disabled={!ready || !strokes.length}
            className="rounded-full px-5 py-2 font-extrabold bg-vx-accent text-vx-accent-ink hover:bg-vx-accent-hover disabled:opacity-40">
            Use drawing
          </button>
        </div>
      </div>
    </div>
  );
}
