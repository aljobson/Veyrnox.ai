'use client';
import { useEffect, useRef } from 'react';
import { transitionPreview } from '../../_lib/editorGuidance.mjs';
import { NEW_TRANSITION_IDS } from '../../_lib/editorTransitionGeometry.mjs';
import { paintTransitionPreview } from '../../_lib/editorTransitionPreviewPaint.mjs';

const PREVIEW_WIDTH = 192, PREVIEW_HEIGHT = 108, CYCLE_MS = 1800, HOLD_MS = 400;
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Drawn with the compositor's own geometry, so the preview matches the export. */
function CanvasPreview({ id }) {
    const canvas = useRef(null);
    useEffect(() => {
        const g = canvas.current?.getContext('2d');
        if (!g) return undefined;
        if (reducedMotion()) { paintTransitionPreview(g, PREVIEW_WIDTH, PREVIEW_HEIGHT, id, 0.5); return undefined; }
        let frame = 0;
        const start = performance.now();
        const tick = now => {
            const phase = ((now - start) % CYCLE_MS) / (CYCLE_MS - HOLD_MS);
            paintTransitionPreview(g, PREVIEW_WIDTH, PREVIEW_HEIGHT, id, Math.min(1, Math.max(0.001, phase)));
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [id]);
    return <canvas ref={canvas} aria-hidden="true" width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} className="block aspect-video w-full rounded-md bg-slate-900" />;
}

/** Looping two-clip preview of one transition. Stays still when the user prefers reduced motion. */
export function TransitionPreview({ id }) {
    const outgoing = useRef(null), incoming = useRef(null), overlay = useRef(null);
    const drawn = NEW_TRANSITION_IDS.includes(id);
    useEffect(() => {
        if (drawn || reducedMotion()) return undefined;
        const plan = transitionPreview(id), running = [];
        const options = { duration: plan.duration, iterations: Infinity, easing: 'ease-in-out', delay: 0, endDelay: 400 };
        for (const [node, frames] of [[outgoing.current, plan.outgoing], [incoming.current, plan.incoming], [overlay.current, plan.overlay]]) {
            if (node && frames && node.animate) running.push(node.animate(frames, options));
        }
        return () => running.forEach(animation => animation.cancel());
    }, [id, drawn]);
    if (drawn) return <CanvasPreview id={id} />;
    const plan = transitionPreview(id);
    return <span aria-hidden="true" className="relative block aspect-video overflow-hidden rounded-md bg-slate-900">
        <span ref={outgoing} className={`absolute inset-0 flex items-center justify-center text-lg font-black text-white bg-cyan-500`}>A</span>
        <span ref={incoming} className={`absolute inset-0 flex items-center justify-center text-lg font-black text-white bg-fuchsia-600`}>B</span>
        {plan.overlay && <span ref={overlay} className={`absolute inset-0 flex items-center justify-center text-lg font-black text-white ${id === 'flash' ? 'bg-white' : 'bg-black'} opacity-0`} />}
    </span>;
}
