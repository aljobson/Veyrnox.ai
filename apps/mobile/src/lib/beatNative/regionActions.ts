import { t } from '../i18n';
import { guardedRippleDelete, positionParts } from './arrange';
import { deleteRegion, duplicateRegion, moveRegion, resizeRegion, splitRegion, trimRegionStart, type BeatDoc, type BeatRegionDoc, type BeatTrackDoc, type Edit } from './doc';
export type Apply = (operation: Edit, announce?: string) => boolean;
export const position = (tick: number) => t(tick % 960 ? 'beat.positionStep' : 'beat.position', positionParts(tick));
export function regionName(doc: BeatDoc, region: BeatRegionDoc) {
    return region.clipId ? doc.clips?.[region.clipId]?.name ?? t('beat.kind.midi') : region.assetId ? doc.assets?.[region.assetId]?.name ?? t('beat.kind.audio') : region.pattern ?? '';
}
export function regionLabel(doc: BeatDoc, track: BeatTrackDoc, region: BeatRegionDoc) {
    return t('beat.region.label', { kind: t(region.clipId ? 'beat.kind.midi' : region.assetId ? 'beat.kind.audio' : 'beat.kind.drums'), name: regionName(doc, region), track: track.name, start: position(region.start), end: position(region.start + region.length) });
}
export function regionActions(doc: BeatDoc, track: BeatTrackDoc, region: BeatRegionDoc, snap: number, locator: number, ripple = false) {
    const neighbour = (delta: number) => doc.tracks[Math.max(0, Math.min(doc.tracks.length - 1, doc.tracks.findIndex(item => item.id === track.id) + delta))].id;
    return [
        { name: 'earlier', label: t('beat.region.earlier'), operation: (d: BeatDoc) => moveRegion(d, region.id, Math.max(0, region.start - snap), track.id) },
        { name: 'later', label: t('beat.region.later'), operation: (d: BeatDoc) => moveRegion(d, region.id, region.start + snap, track.id) },
        { name: 'previousTrack', label: t('beat.region.previousTrack'), operation: (d: BeatDoc) => moveRegion(d, region.id, region.start, neighbour(-1)) },
        { name: 'nextTrack', label: t('beat.region.nextTrack'), operation: (d: BeatDoc) => moveRegion(d, region.id, region.start, neighbour(1)) },
        { name: 'shorter', label: t('beat.region.shorter'), operation: (d: BeatDoc) => resizeRegion(d, region.id, region.length - snap) },
        { name: 'longer', label: t('beat.region.longer'), operation: (d: BeatDoc) => resizeRegion(d, region.id, region.length + snap) },
        { name: 'trim', label: t('beat.region.trim'), operation: (d: BeatDoc) => trimRegionStart(d, region.id, region.start + snap) },
        { name: 'extend', label: t('beat.region.extend'), operation: (d: BeatDoc) => trimRegionStart(d, region.id, region.start - snap) },
        { name: 'split', label: t('beat.region.split'), operation: (d: BeatDoc) => splitRegion(d, region.id, locator) },
        { name: 'duplicate', label: t('beat.region.duplicate'), operation: (d: BeatDoc) => duplicateRegion(d, region.id) },
        { name: 'delete', label: t('beat.region.delete'), operation: (d: BeatDoc) => ripple ? guardedRippleDelete(d, track.id, region.id) : deleteRegion(d, region.id) },
    ];
}
