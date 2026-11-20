import { translateEditorRender } from '../../../lib/editorServerRenderTranslate.js';
import { emptyTimeline } from '../src/lib/nativeEditorModel';
import { exportRefusal } from '../src/lib/editorExportRefusal';
import { exportError, exportFeature } from '../src/lib/editorServerExport';
import { ApiError } from '../src/lib/api';
import { t } from '../src/lib/i18n';
const advanced = 'rate reverse speedCurve freezeFrame fadeIn fadeOut pan eq preservePitch audioProcessing audioEffects transform keyframes parameterKeyframes animation filter crop fit effect blend background mask maskSettings maskKeyframes colourAdjustment smartPicture groupId transitionType text.style text.caption text.words text.wordStyle text.wordsEstimated text.animation text.keyframes text.groupId text.x fonts media.image media.graphic media.originalAudio media.assetSource'.split(' ');
test.each(advanced)('%s names its tool without internal codes', feature => {
    const message = exportRefusal(feature);
    expect(message).not.toBe(exportRefusal(undefined)); expect(message.endsWith('.')).toBe(true);
    expect(message.slice(0, -1)).not.toMatch(/[a-z][A-Z]|_|\.|veyrnox\.ai|http/);
    expect(exportError(new ApiError(422, 'editor_render_unsupported', { feature }))).toBe(message);
});
test.each([undefined, null, 'unknown', {}, 42])('unknown %s is plain and generic', feature => {
    expect(exportRefusal(feature)).toBe("Phone export can't include one of this project's edits yet.");
});
test.each('multiple_tracks track_visibility overlapping_clips source_aspect schemaVersion canvas.frame_rate'.split(' '))('structural %s wording stays unchanged', feature => {
    expect(exportError(new ApiError(422, 'editor_render_unsupported', { feature }))).toBe(`${t('editorServerExport.unsupported')} ${exportFeature(feature)}`);
});
test.each(['clip', 'sequence'])('%s background has the same unambiguous message', kind => {
    const tl = emptyTimeline();
    tl.media.m = { id: 'm', kind: 'video', frames: 90, name: 'Source', hasAudio: true, width: 640, height: 360 };
    tl.video = [{ id: 'v1', mediaId: 'm', start: 0, in: 0, len: 90, volume: 1, transition: 0, trackId: 'video-0' }];
    if (kind === 'sequence') tl.background = '#ffffff'; else Object.assign(tl.video[0], { background: { color: '#ffffff' } });
    const result = translateEditorRender(tl); expect(result).toMatchObject({ error: 'editor_render_unsupported', feature: 'background' });
    expect(exportError(new ApiError(422, 'editor_render_unsupported', { feature: 'feature' in result ? result.feature : undefined }))).toBe("Phone export can't include custom backgrounds yet.");
});
