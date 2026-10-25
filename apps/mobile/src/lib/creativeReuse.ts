import { CREATIVE_FEATURES, type CreativeFeature } from './creativeFeatures';
import type { Kind } from './media';

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const KINDS: readonly Kind[] = ['image', 'video', 'audio'];

export interface CreativeReuse {
    readonly jobId: string;
    readonly kind: Kind;
}

export function kindForMime(mime: string): Kind | null {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return null;
}

// Navigation carries only a safe job id and its coarse media kind. The Create API resolves the file and
// independently checks ownership, expiry and kind before it accepts the source.
export function readCreativeReuse(jobId: unknown, kind: unknown): CreativeReuse | null {
    if (typeof jobId !== 'string' || !SAFE_ID.test(jobId)) return null;
    if (typeof kind !== 'string' || !KINDS.includes(kind as Kind)) return null;
    return { jobId, kind: kind as Kind };
}

export function compatibleCreativeFeatures(kind: Kind): readonly CreativeFeature[] {
    return CREATIVE_FEATURES.filter((feature) => feature.media.includes(kind));
}

export const creativeReuseHref = (jobId: string, kind: Kind) => ({
    pathname: '/features',
    params: { sourceJobId: jobId, sourceKind: kind },
}) as const;

export const creativeReuseTargetHref = (slug: string, reuse: CreativeReuse) => ({
    pathname: '/features/[slug]',
    params: { slug, sourceJobId: reuse.jobId, sourceKind: reuse.kind },
}) as const;
