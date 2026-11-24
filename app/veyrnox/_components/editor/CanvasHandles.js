'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { useRef, useState } from 'react';
import { evaluatedTransform } from '../../_lib/editorSequenceRender.mjs';
import { snapTextPosition } from '../../_lib/editorTextGuides.mjs';
export function CanvasHandles({ item, kind, frame, disabled, onChange }) {
  const { t } = useI18n();
    const drag = useRef(null), [ghost, setGhost] = useState(null);
    if (!item) return null;
    const transform = evaluatedTransform(item, Math.max(0, frame - item.start), false), x = ghost?.x ?? (kind === 'text' ? item.x+transform.x-.5 : transform.x), y = ghost?.y ?? (kind === 'text' ? item.y+transform.y-.5 : transform.y);
    const scale = kind === 'text' ? (ghost?.size ?? item.size) / item.size : ghost?.scale ?? transform.scale;
    const down = (event, mode) => { event.preventDefault(); const bounds = event.currentTarget.parentElement.parentElement.getBoundingClientRect(); drag.current = { x: event.clientX, y: event.clientY, bounds, mode, atX: x, atY: y, scale, size: item.size, next: null }; event.currentTarget.setPointerCapture(event.pointerId); };
    const move = event => { const d = drag.current; if (!d) return; const dx = (event.clientX - d.x) / d.bounds.width, dy = (event.clientY - d.y) / d.bounds.height;
        if (d.mode === 'scale') { d.next=kind === 'text' ? { size: Math.max(2, Math.min(40, Math.round(d.size + (dx - dy) * 20))) } : { scale: Math.max(0.05, Math.min(8, d.scale + dx * 2)) };setGhost(d.next); return; }
        const next = { x: Math.max(0, Math.min(1, d.atX + dx)), y: Math.max(0, Math.min(1, d.atY + dy)) };
        d.next=kind === 'text' ? snapTextPosition(next.x, next.y) : next;setGhost(d.next);
    };
    const up = () => { if (!drag.current) return; const next = drag.current.next ?? ghost; drag.current = null; setGhost(null); if (!next) return;
        if (kind === 'text') onChange(next.size !== undefined ? { size: next.size } : { x: Math.max(0,Math.min(1,item.x+(next.x??x)-x)), y: Math.max(0,Math.min(1,item.y+(next.y??y)-y)) });
        else onChange({ transform: { ...transform, ...next } });
    };
    const moveKey = event => { if (disabled || kind !== 'text' || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return; event.preventDefault(); const step = event.shiftKey ? .05 : .01;
        const next=snapTextPosition(item.x+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),item.y+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0),0.000001);onChange({x:next.x,y:next.y}); };
    const sizeKey = event => { if (disabled || kind !== 'text' || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return; event.preventDefault();
        onChange({size:Math.max(2,Math.min(40,item.size+(event.key==='ArrowLeft'||event.key==='ArrowDown'?-1:1)))}); };
    return <div dir="ltr" className="pointer-events-none absolute inset-0 overflow-hidden" aria-label={t("app.editor.canvas.selection")}>
        {ghost?.guideX !== null && ghost?.guideX !== undefined && <div aria-hidden="true" className="absolute inset-y-0 w-px bg-vx-accent" style={{ insetInlineStart: `${ghost.guideX * 100}%` }} />}
        {ghost?.guideY !== null && ghost?.guideY !== undefined && <div aria-hidden="true" className="absolute inset-x-0 h-px bg-vx-accent" style={{ top: `${ghost.guideY * 100}%` }} />}
        <div className="absolute -translate-x-1/2 -translate-y-1/2 border border-vx-accent" style={{ insetInlineStart: `${x * 100}%`, top: `${y * 100}%`, width: `${Math.min(100, (kind === 'text' ? 50 : 80) * scale)}%`, height: kind === 'text' ? '25%' : `${Math.min(100, 80 * scale)}%` }}>
            <button type="button" disabled={disabled} aria-label={t("app.editor.canvas.move")} className="pointer-events-auto absolute inset-0 cursor-move touch-none" onKeyDown={moveKey} onPointerDown={e => down(e, 'move')} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setGhost(null); }} />
            {(kind === 'video' || kind === 'text') && <button type="button" disabled={disabled} aria-label={t("app.editor.canvas.resize")} className="pointer-events-auto absolute -bottom-1 -end-1 size-3 cursor-nwse-resize touch-none rounded-full bg-vx-accent" onKeyDown={sizeKey} onPointerDown={e => down(e, 'scale')} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setGhost(null); }} />}
        </div>
    </div>;
}
