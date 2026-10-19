'use client';

import { createElement, useMemo } from 'react';
import { mannequinShapes, mannequinViewBox } from '../_lib/oddlingMannequin';

// The preview figure. Shapes come from the pure geometry in _lib/oddlingMannequin, so the same code is tested without a browser.
export function OddlingMannequin({ picks, focus = 'body', className, label }) {
  const shapes = useMemo(() => mannequinShapes(picks), [picks]);
  const viewBox = mannequinViewBox(focus, picks);
  return (
    <svg viewBox={viewBox} className={className === undefined ? "h-full w-full" : className} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'} preserveAspectRatio="xMidYMid meet">
      {shapes.map(({ key, tag, attrs, fill, stroke, opacity }) => createElement(tag, { key, ...attrs, fill, ...(stroke ? { stroke } : {}), ...(opacity ? { opacity } : {}) }))}
    </svg>
  );
}
