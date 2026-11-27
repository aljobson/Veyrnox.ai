/**
 * Canonical eligibility for a non-destructive behind-subject overlay.
 * The overlay remains a normal timeline item; its reference only changes compositor order.
 */
export function behindSubjectCandidates(timeline, overlay) {
    if (!overlay || (!('text' in overlay) && !['image', 'graphic'].includes(timeline.media?.[overlay.mediaId]?.kind))) return [];
    return timeline.video.filter(subject => subject.id !== overlay.id
        && subject.semanticMask?.category === 'person'
        && overlay.start >= subject.start
        && overlay.start + overlay.len <= subject.start + subject.len);
}

export function setBehindSubject(timeline, kind, id, subjectId) {
    if (!['video', 'text'].includes(kind)) return { error: 'Choose a title or image overlay.' };
    const overlay = timeline[kind]?.find(item => item.id === id);
    if (!overlay) return { error: 'Choose an overlay first.' };
    if (subjectId === null || subjectId === undefined || subjectId === '') {
        const { behindSubject: _behindSubject, ...rest } = overlay;
        return { ...timeline, [kind]: timeline[kind].map(item => item.id === id ? rest : item) };
    }
    if (!behindSubjectCandidates(timeline, overlay).some(subject => subject.id === subjectId)) {
        return { error: 'Choose an overlapping clip with a whole-person mask.' };
    }
    return { ...timeline, [kind]: timeline[kind].map(item => item.id === id ? { ...item, behindSubject: subjectId } : item) };
}
