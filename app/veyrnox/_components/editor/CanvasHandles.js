'use client';
import { useRef, useState } from 'react';
import { evaluatedTransform } from '../../_lib/editorSequenceRender.mjs';
export function CanvasHandles({ item, kind, frame, disabled, onChange }) {
    const drag = useRef(null), [ghost, setGhost] = useState(null);
    if (!item) return null;
    const t = evaluatedTransform(item, Math.max(0, frame - item.start), false), x = ghost?.x ?? (kind === 'text' ? item.x+t.x-.5 : t.x), y = ghost?.y ?? (kind === 'text' ? item.y+t.y-.5 : t.y), scale = ghost?.scale ?? t.scale;
    const down = (event, mode) => { event.preventDefault(); const bounds = event.currentTarget.parentElement.parentElement.getBoundingClientRect(); drag.current = { x: event.clientX, y: event.clientY, bounds, mode, atX: x, atY: y, scale }; event.currentTarget.setPointerCapture(event.pointerId); };
    const move = event => { const d = drag.current; if (!d) return; const dx = (event.clientX - d.x) / d.bounds.width, dy = (event.clientY - d.y) / d.bounds.height; setGhost(d.mode === 'scale' ? { scale: Math.max(0.05, Math.min(8, d.scale + dx * 2)) } : { x: Math.max(0, Math.min(1, d.atX + dx)), y: Math.max(0, Math.min(1, d.atY + dy)) }); };
    const up = () => { if (!drag.current) return; const next = ghost; drag.current = null; setGhost(null); if (next) onChange(kind === 'text' ? { x: Math.max(0,Math.min(1,item.x+(next.x??x)-x)), y: Math.max(0,Math.min(1,item.y+(next.y??y)-y)) } : { transform: { ...t, ...next } }); };
    return <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-label="Canvas selection">
        <div className="absolute -translate-x-1/2 -translate-y-1/2 border border-vx-accent" style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${Math.min(100, (kind === 'text' ? 50 : 80) * scale)}%`, height: kind === 'text' ? '25%' : `${Math.min(100, 80 * scale)}%` }}>
            <button type="button" disabled={disabled} aria-label="Move selection on canvas" className="pointer-events-auto absolute inset-0 cursor-move touch-none" onPointerDown={e => down(e, 'move')} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setGhost(null); }} />
            {kind === 'video' && <button type="button" disabled={disabled} aria-label="Resize selection on canvas" className="pointer-events-auto absolute -bottom-1 -right-1 size-3 cursor-nwse-resize touch-none rounded-full bg-vx-accent" onPointerDown={e => down(e, 'scale')} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setGhost(null); }} />}
        </div>
    </div>;
}
