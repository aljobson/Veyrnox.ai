'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { useRef, useState } from 'react';
import { evaluatedTransform } from '../../_lib/editorSequenceRender.mjs';
export function CanvasHandles({ item, kind, frame, disabled, onChange }) {
  const { t } = useI18n();
    const drag = useRef(null), [ghost, setGhost] = useState(null);
    if (!item) return null;
    const transform = evaluatedTransform(item, Math.max(0, frame - item.start), false), x = ghost?.x ?? (kind === 'text' ? item.x+transform.x-.5 : transform.x), y = ghost?.y ?? (kind === 'text' ? item.y+transform.y-.5 : transform.y), scale = ghost?.scale ?? transform.scale;
    const down = (event, mode) => { event.preventDefault(); const bounds = event.currentTarget.parentElement.parentElement.getBoundingClientRect(); drag.current = { x: event.clientX, y: event.clientY, bounds, mode, atX: x, atY: y, scale }; event.currentTarget.setPointerCapture(event.pointerId); };
    const move = event => { const d = drag.current; if (!d) return; const dx = (event.clientX - d.x) / d.bounds.width, dy = (event.clientY - d.y) / d.bounds.height; setGhost(d.mode === 'scale' ? { scale: Math.max(0.05, Math.min(8, d.scale + dx * 2)) } : { x: Math.max(0, Math.min(1, d.atX + dx)), y: Math.max(0, Math.min(1, d.atY + dy)) }); };
    const up = () => { if (!drag.current) return; const next = ghost; drag.current = null; setGhost(null); if (next) onChange(kind === 'text' ? { x: Math.max(0,Math.min(1,item.x+(next.x??x)-x)), y: Math.max(0,Math.min(1,item.y+(next.y??y)-y)) } : { transform: { ...transform, ...next } }); };
    return <div dir="ltr" className="pointer-events-none absolute inset-0 overflow-hidden" aria-label={t("app.editor.canvas.selection")}>
        <div className="absolute -translate-x-1/2 -translate-y-1/2 border border-vx-accent" style={{ insetInlineStart: `${x * 100}%`, top: `${y * 100}%`, width: `${Math.min(100, (kind === 'text' ? 50 : 80) * scale)}%`, height: kind === 'text' ? '25%' : `${Math.min(100, 80 * scale)}%` }}>
            <button type="button" disabled={disabled} aria-label={t("app.editor.canvas.move")} className="pointer-events-auto absolute inset-0 cursor-move touch-none" onPointerDown={e => down(e, 'move')} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setGhost(null); }} />
            {kind === 'video' && <button type="button" disabled={disabled} aria-label={t("app.editor.canvas.resize")} className="pointer-events-auto absolute -bottom-1 -end-1 size-3 cursor-nwse-resize touch-none rounded-full bg-vx-accent" onPointerDown={e => down(e, 'scale')} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setGhost(null); }} />}
        </div>
    </div>;
}
