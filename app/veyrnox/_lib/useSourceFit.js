'use client';
import { useEffect, useState } from 'react';
import { generationSlotKind, sourceList } from '../../../lib/generationSourceSlots.mjs';
import { aspectFitPlan, aspectShapeLabel, hasAspectBounds, measureImage } from './sourceAspectFit.js';

const CLEAR = Object.freeze({ blocked: false, trimmed: false, min: '', max: '' });

/** Summarises the chosen pictures against their slots' published shape. */
export async function sourceFitState(media, sources, measure = measureImage) {
  let trimmed = false;
  for (const [slot, value] of Object.entries(sources || {})) {
    const spec = media?.[slot];
    if (generationSlotKind(slot) !== 'image' || !hasAspectBounds(spec)) continue;
    for (const source of sourceList(value)) {
      if (!source?.file || source.assetId || source.sourceKey) continue;
      const size = await measure(source.file);
      const plan = size ? aspectFitPlan(size, spec) : { action: 'keep' };
      if (plan.action === 'refuse' && plan.code === 'source_aspect_out_of_range') {
        return { blocked: true, trimmed: false, min: aspectShapeLabel(spec.minAspect), max: aspectShapeLabel(spec.maxAspect) };
      }
      if (plan.action === 'crop') trimmed = true;
    }
  }
  return trimmed ? { ...CLEAR, trimmed } : CLEAR;
}

export function useSourceFit(media, sources) {
  const [fit, setFit] = useState(CLEAR);
  useEffect(() => {
    let current = true;
    sourceFitState(media, sources).then((next) => { if (current) setFit(next); }, () => { if (current) setFit(CLEAR); });
    return () => { current = false; };
  }, [media, sources]);
  return fit;
}
