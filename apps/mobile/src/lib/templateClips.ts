import { useEffect, useState } from 'react';
import { publicTemplateClip } from '../../../../app/veyrnox/_lib/templateClips.js';
import { API_BASE } from './api';
import type { CatalogModel } from './media';

export interface TemplateClip {
    readonly id: string;
    readonly model: 'seedance-2.0-reference';
    readonly credits: number;
    readonly durationSeconds: 5;
}

export async function fetchTemplateClip(id: string): Promise<TemplateClip | null> {
    if (!publicTemplateClip(id)) return null;
    const response = await fetch(`${API_BASE}/api/catalog?template_clip=${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const clip = await response.json();
    return clip?.id === id && clip.model === 'seedance-2.0-reference' && Number.isInteger(clip.credits) && clip.credits > 0 && clip.durationSeconds === 5 ? clip : null;
}

export function useTemplateClipAvailable(id: string) {
    const [clip, setClip] = useState<TemplateClip | null>(null);
    useEffect(() => {
        let live = true;
        fetchTemplateClip(id).then(value => { if (live) setClip(value); }, () => { if (live) setClip(null); });
        return () => { live = false; };
    }, [id]);
    return clip?.id === id ? clip : null;
}

export function templateClipModel(model: CatalogModel, clip: TemplateClip): CatalogModel {
    return { ...model, credits: clip.credits, durations: [5], capabilities: { ...model.capabilities,
        media: { image: { ...model.capabilities?.media?.image, required: true, maxFiles: 1 } } } };
}
