import { useRef } from 'react';
import { clamp } from '../../../../packages/live-edit/effects.js';
export function StickerHandles({ stickers, t, update, disabled }) {
    const drag = useRef(null);
    function move(event, index) {
        if (drag.current !== index) return;
        const bounds = event.currentTarget.parentElement.getBoundingClientRect();
        update({ stickers: stickers.map((s, i) => i === index ? { ...s, x: clamp((event.clientX - bounds.left) / bounds.width), y: clamp((event.clientY - bounds.top) / bounds.height) } : s) });
    }
    return stickers.map((sticker, index) => <button key={index} type="button" aria-label={t(`app.photoStudio.${sticker.kind}`)} disabled={disabled}
        className="absolute min-h-11 min-w-11 -translate-x-1/2 -translate-y-1/2 touch-none rounded-xl border border-transparent focus:border-vx-accent focus:outline focus:outline-2 focus:outline-vx-accent"
        style={{ left: `${sticker.x * 100}%`, top: `${sticker.y * 100}%`, width: `${sticker.size * 100}%`, aspectRatio: 1 }}
        onPointerDown={e => { drag.current = index; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => move(e, index)} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onKeyDown={e => {
            if (['Delete', 'Backspace'].includes(e.key)) { e.preventDefault(); update({ stickers: stickers.filter((_, i) => i !== index) }); return; }
            const delta = { ArrowLeft: [-0.01, 0], ArrowRight: [0.01, 0], ArrowUp: [0, -0.01], ArrowDown: [0, 0.01] }[e.key];
            if (!delta) return; e.preventDefault();
            update({ stickers: stickers.map((s, i) => i === index ? { ...s, x: clamp(s.x + delta[0]), y: clamp(s.y + delta[1]) } : s) });
        }} />);
}
