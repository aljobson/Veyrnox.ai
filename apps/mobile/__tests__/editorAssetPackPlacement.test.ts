import { insertMediaAt } from '../src/lib/editorInsertMedia';
import { emptyTimeline, type Media } from '../src/lib/nativeEditorModel';
import { packMediaDetails, type AssetPack } from '../src/lib/editorAssetPackCatalog';

const pack: AssetPack = { version: 1, id: 'pack-one', name: 'Sound Kit', capabilities: ['local-catalog'], assets: [{ id: 'room', name: 'Room Tone', file: 'room.wav', kind: 'audio',
    category: 'Sound effects', tags: ['quiet'], sha256: 'a'.repeat(64), attribution: { credit: 'Studio', usage: 'Original recording', url: '' } }] };

test('pack audio is ordinary editor media at the playhead and project JSON contains no catalog capability data', () => {
    const asset = pack.assets[0]; const media: Media = { id: 'l-11111111-1111-4111-8111-111111111111', name: asset.name, kind: asset.kind, frames: 90,
        hasAudio: true, width: 0, height: 0, ...packMediaDetails(pack, asset) };
    const result = insertMediaAt(emptyTimeline(), media, 42); if ('error' in result) throw Error(result.error);
    expect(result.timeline.audio).toEqual([expect.objectContaining({ start: 42, mediaId: media.id })]); expect(result.timeline.video).toEqual([]);
    expect(result.timeline.media[media.id]).toEqual(expect.objectContaining({ sourceName: 'room.wav', folder: 'Asset packs/Sound Kit/Sound effects', attribution: asset.attribution }));
    const saved = JSON.stringify(result.timeline);
    for (const forbidden of ['local-catalog', 'capabilities', '"assets"', '"tags"', asset.sha256]) expect(saved).not.toContain(forbidden);
    expect(saved).not.toContain('originalAudio');
});
