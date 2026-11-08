// Optional bounds: only the kie Seedance record opts in (ADR-0333).
export function checkMediaBounds(spec, source) {
    if (spec.minPixels || spec.minAspect || spec.shortSides) {
        const d = source.dimensions;
        if (!d || ![d.width, d.height].every(n => Number.isInteger(n) && n > 0)) return 'source_size_unknown';
        if (spec.minPixels && d.width * d.height < spec.minPixels) return 'source_too_small';
        const aspect = d.width / d.height;
        if (spec.minAspect && (aspect < spec.minAspect || aspect > spec.maxAspect)) return 'source_aspect_out_of_range';
        if (spec.shortSides && !spec.shortSides.includes(Math.min(d.width, d.height))) return 'source_resolution_out_of_range';
    }
    if (spec.maxBytesExclusive) {
        if (!Number.isSafeInteger(source.sizeBytes) || source.sizeBytes <= 0) return 'source_size_unknown';
        if (source.sizeBytes >= spec.maxBytesExclusive) return 'source_too_large';
    }
    if (spec.minFrameRate) {
        if (source.videoSeconds > spec.maxSeconds) return 'source_too_long';
        if (!Number.isFinite(source.frameRate)) return 'source_frame_rate_unknown';
        if (source.frameRate < spec.minFrameRate || source.frameRate > spec.maxFrameRate) return 'source_frame_rate_out_of_range';
    }
    return null;
}
