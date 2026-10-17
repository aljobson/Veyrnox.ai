'use client';
import { useEffect, useRef } from 'react';
import { transitionPreview } from '../../_lib/editorGuidance.mjs';

const layer = 'absolute inset-0 flex items-center justify-center text-lg font-black text-white';

/** Looping two-clip preview of one transition. Stays still when the user prefers reduced motion. */
export function TransitionPreview({ id }) {
    const outgoing = useRef(null), incoming = useRef(null), overlay = useRef(null);
    useEffect(() => {
        if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
        const plan = transitionPreview(id), running = [];
        const options = { duration: plan.duration, iterations: Infinity, easing: 'ease-in-out', delay: 0, endDelay: 400 };
        for (const [node, frames] of [[outgoing.current, plan.outgoing], [incoming.current, plan.incoming], [overlay.current, plan.overlay]]) {
            if (node && frames && node.animate) running.push(node.animate(frames, options));
        }
        return () => running.forEach(animation => animation.cancel());
    }, [id]);
    const plan = transitionPreview(id);
    return <span aria-hidden="true" className="relative block aspect-video overflow-hidden rounded-md bg-slate-900">
        <span ref={outgoing} className={`${layer} bg-cyan-500`}>A</span>
        <span ref={incoming} className={`${layer} bg-fuchsia-600`}>B</span>
        {plan.overlay && <span ref={overlay} className={`${layer} ${id === 'flash' ? 'bg-white' : 'bg-black'} opacity-0`} />}
    </span>;
}
