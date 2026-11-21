import { AUDIO_DEFAULTS } from '../../../app/veyrnox/_lib/editorAudioSettings.mjs';
import { AUDIO_EFFECT_DEFAULTS } from '../../../app/veyrnox/_lib/editorAudioEffects.mjs';
import { originalAudioMedia } from '../src/lib/editorOriginalAudio';
import { ApiError, type ApiClient } from '../src/lib/api';
import { SERVER_PLAIN_TEXT_STYLE, exportCopy, exportDurations, exportError, exportFeature, exportIdentity, exportSourceLink, freezeExport, renderStatus, sendExportAttempt } from '../src/lib/editorServerExport';
import { DEFAULT_TEXT_STYLE, emptyTimeline, type Timeline } from '../src/lib/nativeEditorModel';
import type { ProjectDocument } from '../src/lib/editorBridge';
import { probeDuration } from '../src/lib/editorMediaDuration';
import type { ExportRecord } from '../src/lib/editorServerExportStore';
const owner = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222';
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => '11111111-1111-4111-8111-111111111111', subscribeCacheUser: () => () => {} }));
jest.mock('../src/lib/editorMediaDuration', () => ({ probeDuration: jest.fn() }));
const file = { file: 'file://durable', type: 'video/mp4', size: 100, seconds: 4, verified: true as const };
const fixture = (mediaId = `l-${id}`, len = 120): ProjectDocument => ({ project_id: id, schema_version: 3, canvas: { aspect_ratio: '16:9', frame_rate: 30 }, timeline: { ...emptyTimeline(), media: { [mediaId]: { id: mediaId, kind: 'video', name: 'Clip', frames: 300, assetSource: { projectId: id, assetId: owner } }, unused: { id: 'unused', kind: 'image' } }, video: [{ id: 'v1', mediaId, in: 0, len, start: 0, trackId: 'video-0', rate: 1, groupId: 'g1' }], text: [{ id: 't1', text: 'Title', x: .5, y: .85, size: 6, len: 90, start: 0, style: { ...DEFAULT_TEXT_STYLE }, groupId: 'g1' }] } });
test('export identity ignores only local backup metadata and leaves the document unchanged', () => {
    const saved = fixture(), before = JSON.stringify(saved), identity = exportIdentity(saved);
    expect(JSON.stringify(saved)).toBe(before);
    delete (saved.timeline as Timeline).media[`l-${id}`].assetSource;
    expect(exportIdentity(saved)).toBe(identity);
    (saved.timeline as Timeline).video[0].len--;
    expect(exportIdentity(saved)).not.toBe(identity);
    const remote = fixture(`j-${id}`), remoteIdentity = exportIdentity(remote);
    delete (remote.timeline as Timeline).media[`j-${id}`].assetSource;
    expect(exportIdentity(remote)).not.toBe(remoteIdentity);
});
test('phone v3 export strips only the agreed defaults, removes unused media, and never mutates saved data', () => {
    const saved = fixture(); const before = JSON.stringify(saved);
    const result = exportCopy(saved, { [`l-${id}`]: file }); const tl = result.document.timeline as Timeline;
    expect(result.blocked).toEqual([]); expect(result.uploads).toHaveLength(1);
    expect(Object.keys(tl.media)).toEqual([`l-${id}`]); expect(tl.media[`l-${id}`]).toMatchObject({ frames: 120 });
    expect(tl.media[`l-${id}`].assetSource).toBeUndefined();
    const clipKeys = ['id', 'mediaId', 'in', 'len', 'volume', 'transition', 'start', 'trackId', 'transitionType'];
    const textKeys = ['id', 'text', 'start', 'len', 'x', 'y', 'size', 'trackId'];
    expect(Object.keys(tl.video[0]).every(k => clipKeys.includes(k))).toBe(true);
    expect(Object.keys(tl.text[0]).every(k => textKeys.includes(k))).toBe(true);
    expect(JSON.stringify(saved)).toBe(before);
    (saved.timeline as Timeline).video[0].rate = 2; (saved.timeline as Timeline).text[0].style!.color = 'red';
    const changed = exportCopy(saved, { [`l-${id}`]: file }).document.timeline as Timeline;
    expect(changed.video[0].rate).toBe(2); expect(changed.text[0].style?.color).toBe('red');
});
test.each([['p-', 'notOnPhone'], ['l-', 'notOnPhone'], ['j-', 'durationUnknown'], ['j-', 'unsupported', '--vocals']])('blocks %s: %s', (prefix, reason, suffix = '') => {
    expect(exportCopy(fixture(`${prefix}${id}${suffix}`), {}).blocked[0].reason).toBe(reason);
});
test.each([4, 20])('Files import with %s seconds uses the real frames before quote', async seconds => {
    (probeDuration as jest.Mock).mockResolvedValue(seconds);
    const saved = fixture(`l-${id}`, seconds * 30), files = { [`l-${id}`]: { ...file, verified: undefined, seconds: undefined } };
    const durations = await exportDurations({} as ApiClient, saved, files);
    const result = exportCopy(saved, files, durations);
    expect((result.document.timeline as Timeline).media[`l-${id}`].frames).toBe(seconds * 30); expect(result.blocked).toEqual([]);
});
test('blocks an overlong clip and unverified source', () => {
    expect(exportCopy(fixture(`l-${id}`, 121), { [`l-${id}`]: file }).blocked[0].reason).toBe('clipLongerThanFile');
    expect(exportCopy(fixture(), { [`l-${id}`]: { ...file, verified: undefined } }).blocked[0].reason).toBe('durationUnknown');
});
test.each([['j', 'audio', 'audio/mpeg', '/jobs/'], ['j', 'video', 'video/mp4', '/jobs/'], ['e', 'video', 'video/mp4', '/editor-renders/'], ['f', 'video', 'video/mp4', '/masters/']])('resolves %s %s source links', async (prefix, kind, mime, path) => {
    const request = jest.fn().mockResolvedValue({ url: 'https://files.test/source', mime_type: mime });
    expect(await exportSourceLink({ request } as unknown as ApiClient, { id: `${prefix}-${id}`, kind })).toBe('https://files.test/source'); expect(request.mock.calls[0][0]).toContain(path);
});
test('rejects mismatched MIME, insecure links, and stems without a request', async () => {
    const request = jest.fn().mockResolvedValue({ url: 'https://files.test/source', mime_type: 'video/mp4' }); const api = { request } as unknown as ApiClient;
    expect(await exportSourceLink(api, { id: `j-${id}`, kind: 'audio' })).toBeNull();
    request.mockResolvedValue({ url: 'http://files.test/source', mime_type: 'video/mp4' });
    expect(await exportSourceLink(api, { id: `j-${id}`, kind: 'video' })).toBeNull(); request.mockClear();
    expect(await exportSourceLink(api, { id: `j-${id}--vocals`, kind: 'audio' })).toBeNull(); expect(request).not.toHaveBeenCalled();
});
test('error, feature and public status mappings never expose server codes', () => {
    expect(exportError(new ApiError(400, 'editor_render_duration_limit'))).toContain('duration');
    expect(exportError(new ApiError(400, 'editor_render_clip_limit'))).toContain('clips');
    expect(exportError(new ApiError(403, 'editor_render_media_not_owned'), true)).toContain('expired');
    expect(exportFeature('text.style')).toBe('Text'); expect(exportFeature('rate')).toBe('Speed'); expect(exportFeature('untrusted')).toBe('Timeline edit');
    expect(renderStatus({ job_id: id, state: 'succeeded', render_id: owner }).phase).toBe('done');
    expect(renderStatus({ job_id: id, state: 'failed', refunded: true })).toMatchObject({ phase: 'failed', refunded: true });
    expect(renderStatus({ job_id: id, state: 'REFUNDED' }).refunded).toBe(true);
});
test('a transport retry sends an identical immutable key and body only once', async () => {
    const attempt: ExportRecord = freezeExport({ owner, projectId: id, key: id, credits: 7, sentAt: 0, body: { document: fixture(), resolution: '1080p', label: 'Export', quoted_credits: 7 } });
    const request = jest.fn().mockRejectedValueOnce(new ApiError(503, 'gateway')).mockResolvedValue({ job_id: id, state: 'SUBMITTED' });
    await sendExportAttempt({ request } as unknown as ApiClient, attempt);
    expect(request).toHaveBeenCalledTimes(2); expect(request.mock.calls[0]).toEqual(request.mock.calls[1]); expect(Object.isFrozen(attempt.body.document)).toBe(true);
    request.mockReset().mockRejectedValue(new ApiError(503, 'runner_submit_failed', { job_id: id }));
    await expect(sendExportAttempt({ request } as unknown as ApiClient, attempt)).rejects.toMatchObject({ status: 503 }); expect(request).toHaveBeenCalledTimes(1);
});
test('neutral fade, pan and reverse defaults written by trim/fit are not sent, real ones are', () => {
    const saved = fixture(); const clip = (saved.timeline as Timeline).video[0];
    Object.assign(clip, { fadeIn: 0, fadeOut: 0, pan: 0, reverse: false });
    const clean = exportCopy(saved, { [`l-${id}`]: file }).document.timeline as Timeline;
    expect(Object.keys(clean.video[0]).sort()).toEqual(['id', 'in', 'len', 'mediaId', 'start', 'trackId'].sort());
    Object.assign(clip, { fadeIn: 6 });
    expect((exportCopy(saved, { [`l-${id}`]: file }).document.timeline as Timeline).video[0].fadeIn).toBe(6);
});
test('the unsupported message names the audio setting', () => {
    const error = new ApiError(422, 'editor_render_unsupported', { feature: 'fadeIn' });
    expect(exportError(error)).toBe("Phone export can't include audio settings yet.");
});

test('plain export style is independent of authoring defaults and preserves web styling', () => {
    expect(SERVER_PLAIN_TEXT_STYLE).toEqual(DEFAULT_TEXT_STYLE); expect(Object.isFrozen(SERVER_PLAIN_TEXT_STYLE)).toBe(true);
    const saved = fixture();
    const { TEXT_DEFAULTS } = require('../../../app/veyrnox/_lib/editorSequenceValidation.mjs');
    (saved.timeline as Timeline).text[0].style = { ...TEXT_DEFAULTS };
    expect((exportCopy(saved, {}).document.timeline as Timeline).text[0].style).toEqual(TEXT_DEFAULTS);
    (saved.timeline as Timeline).text[0].style = { ...DEFAULT_TEXT_STYLE };
    expect((exportCopy(saved, {}).document.timeline as Timeline).text[0]).not.toHaveProperty('style');
});

test('plain captions strip neutral metadata; timed captions remain refused and titles stay unchanged', () => {
    const { parseCaptions, insertCaptions } = require('../../../app/veyrnox/_lib/editorCaptions.mjs');
    const saved = fixture(), tl = saved.timeline as Timeline;
    const title = { ...tl.text[0] }; delete title.style; delete title.groupId;
    tl.text = [title, { ...title, id: 'native', caption: true },
        { ...title, id: 'empty', caption: true, words: [], wordsEstimated: true, wordStyle: { mode: 'karaoke', color: '#ffe66d' } },
        { ...title, id: 'timed', caption: true, words: [{ text: 'Title', start: 0, len: 90 }], wordsEstimated: false }];
    tl.text.push(...insertCaptions(emptyTimeline(), parseCaptions('1\n00:00:04,000 --> 00:00:05,000\nImported', 'srt').cues).text);
    const before = JSON.stringify(saved), out = exportCopy(saved, {}).document.timeline as Timeline;
    const keys = ['id', 'text', 'start', 'len', 'x', 'y', 'size', 'trackId'];
    for (const text of out.text.filter(c => c.id !== 'timed')) expect(Object.keys(text).every(k => keys.includes(k))).toBe(true);
    expect(out.text[0]).toEqual(title); expect(out.text.find(c => c.id === 'timed')!.words).toHaveLength(1);
    expect(JSON.stringify(saved)).toBe(before);
});

test('export removes neutral web audio resets, retains active edits and blocks original audio first', () => {
    const saved = fixture(), clip = (saved.timeline as Timeline).video[0];
    Object.assign(clip, { eq: { low: 0, mid: 0, high: 0 }, audioProcessing: { ...AUDIO_DEFAULTS },
        audioEffects: { ...AUDIO_EFFECT_DEFAULTS }, preservePitch: false });
    const clean = (exportCopy(saved, { [`l-${id}`]: file }).document.timeline as Timeline).video[0];
    for (const key of ['eq', 'audioProcessing', 'audioEffects', 'preservePitch']) expect(clean).not.toHaveProperty(key);
    Object.assign(clip, { eq: { low: 1, mid: 0, high: 0 }, audioProcessing: { ...AUDIO_DEFAULTS, pitch: 2 },
        audioEffects: { ...AUDIO_EFFECT_DEFAULTS, echoMix: .4 }, preservePitch: true });
    const active = (exportCopy(saved, { [`l-${id}`]: file }).document.timeline as Timeline).video[0];
    for (const key of ['eq', 'audioProcessing', 'audioEffects', 'preservePitch']) expect(active).toHaveProperty(key);
    (saved.timeline as Timeline).media[`l-${id}`] = originalAudioMedia('soft-keys', `l-${id}`);
    expect(exportCopy(saved, {}).blocked).toEqual([{ id: `l-${id}`, name: 'Soft keys', reason: 'originalAudio' }]);
});

test('neutral looks disappear only from the export copy and keep the translator clip contract', () => {
    const { colourDefaults } = require('../../../app/veyrnox/_lib/editorColour.mjs');
    const { FILTER_DEFAULTS } = require('../../../app/veyrnox/_lib/editorAnimation.mjs');
    const { BACKGROUND_DEFAULTS } = require('../../../app/veyrnox/_lib/editorBackground.mjs');
    const saved = fixture(), clip = (saved.timeline as Timeline).video[0];
    Object.assign(clip, { colourAdjustment: colourDefaults(), filter: FILTER_DEFAULTS, effect: { type: 'tiles', intensity: 0 },
        blend: 'source-over', crop: { x: 0, y: 0, width: 1, height: 1 }, background: BACKGROUND_DEFAULTS, transitionType: 'dissolve' });
    const before = JSON.stringify(saved), clean = (exportCopy(saved, {}).document.timeline as Timeline).video[0];
    const allowed = ['id', 'mediaId', 'in', 'len', 'volume', 'transition', 'start', 'trackId', 'transitionType'];
    expect(Object.keys(clean).every(key => allowed.includes(key))).toBe(true);
    expect(clean).not.toHaveProperty('transitionType'); expect(JSON.stringify(saved)).toBe(before);
    clip.effect = { type: 'none', intensity: .5 };
    expect((exportCopy(saved, {}).document.timeline as Timeline).video[0]).not.toHaveProperty('effect');
});
test('active looks retain their S1 export refusal and animated neutral colour/filter stay intact', () => {
    const { colourDefaults } = require('../../../app/veyrnox/_lib/editorColour.mjs');
    const { FILTER_DEFAULTS, parameterKeyframe } = require('../../../app/veyrnox/_lib/editorAnimation.mjs');
    const { exportRefusal } = require('../src/lib/editorExportRefusal');
    const { t } = require('../src/lib/i18n');
    const edits = [
        ['colourAdjustment', { ...colourDefaults(), exposure: .5 }, 'colour'], ['filter', { ...FILTER_DEFAULTS, brightness: 2 }, 'colour'],
        ['effect', { type: 'tiles', intensity: .5 }, 'effects'], ['blend', 'screen', 'blend'],
        ['crop', { x: .1, y: 0, width: .9, height: 1 }, 'crop'], ['background', { type: 'solid', color: '#15211f', blur: 18, mediaId: '' }, 'background'],
        ['transitionType', 'clock-wipe', 'transitions'],
    ] as const;
    for (const [key, value, reason] of edits) {
        const saved = fixture(); Object.assign((saved.timeline as Timeline).video[0], { [key]: value });
        if (key === 'transitionType') {
            const tl = saved.timeline as Timeline;
            tl.video[0].start = 120; tl.video[0].transition = 15;
            tl.video.push({ ...tl.video[0], id: 'v2', start: 0, transition: 0 });
        }
        const copy = exportCopy(saved, {}).document;
        expect((copy.timeline as Timeline).video[0]).toHaveProperty(key, value);
        expect(exportRefusal(key)).toBe(t(`editorExportRefusal.${reason}`));
    }
    const saved = fixture(), clip = (saved.timeline as Timeline).video[0];
    clip.colourAdjustment = colourDefaults(); clip.filter = FILTER_DEFAULTS; clip.parameterKeyframes = [parameterKeyframe(clip, 0)];
    const clean = (exportCopy(saved, {}).document.timeline as Timeline).video[0];
    expect(clean.colourAdjustment).toEqual(clip.colourAdjustment); expect(clean.filter).toEqual(clip.filter);
});
test.each([[0, 120], [15, 121], [15, 120]])('export handles transition %s at start %s without changing saved metadata', (transition, start) => {
    const saved = fixture(), timeline = saved.timeline as Timeline;
    timeline.video.push({ ...timeline.video[0], id: 'v2', start, transition, transitionType: 'clock-wipe' });
    const before = JSON.stringify(saved);
    const copy = exportCopy(saved, { [`l-${id}`]: file }).document.timeline as Timeline;
    if (transition === 0 || start !== 120) expect(copy.video[1]).not.toHaveProperty('transitionType');
    else expect(copy.video[1].transitionType).toBe('clock-wipe');
    expect(JSON.stringify(saved)).toBe(before);
    expect(timeline.video[1].transitionType).toBe('clock-wipe');
});

test('schema 2 clock wipe survives export so the server refuses the unsupported transition', () => {
    const { translateEditorRender } = require('../../../lib/editorServerRenderTranslate');
    const timeline = structuredClone(require('../../../tests/fixtures/editorServerRender/v2.json'));
    timeline.video[1].transitionType = 'clock-wipe';
    const saved: ProjectDocument = { ...fixture(), schema_version: 2, timeline };
    const before = JSON.stringify(saved);
    const durations = Object.fromEntries(Object.keys(timeline.media).map(mediaId => [mediaId, 10]));
    const result = exportCopy(saved, {}, durations);
    expect(result.blocked).toEqual([]);
    expect((result.document.timeline as Timeline).video[1].transitionType).toBe('clock-wipe');
    expect(translateEditorRender(result.document.timeline)).toEqual({ error: 'editor_render_unsupported', feature: 'transitionType' });
    expect(JSON.stringify(saved)).toBe(before);
});

test('S7 export copy drops only inactive defaults and empty arrays, without touching saved fields', () => {
    const saved = fixture(), tl = saved.timeline as Timeline;
    Object.assign(tl.video[0], { transform: { x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, flipX: false, flipY: false },
        keyframes: [], parameterKeyframes: [], mask: 'none', maskSettings: { x: .7, y: .5, width: 1, height: 1, rotation: 0, feather: .1, inverted: true },
        maskKeyframes: [], smartPicture: { denoise: 0, keyEnabled: false, keyColor: '#0000ff', keyTolerance: .12, keyFeather: .1,
            despill: .5, light: 0, lightX: .5, lightY: .5, lightRadius: .6 } });
    const before = JSON.stringify(saved), exported = exportCopy(saved, {}).document.timeline as Timeline;
    for (const key of ['transform', 'keyframes', 'parameterKeyframes', 'mask', 'maskSettings', 'maskKeyframes', 'smartPicture']) {
        expect(Object.hasOwn(exported.video[0], key)).toBe(false);
    }
    expect(JSON.stringify(saved)).toBe(before);
    tl.video[0].transform!.x = .7; tl.video[0].mask = 'circle'; tl.video[0].smartPicture!.keyEnabled = true;
    const active = exportCopy(saved, {}).document.timeline as Timeline;
    expect(active.video[0].transform).toEqual(tl.video[0].transform); expect(active.video[0].mask).toBe('circle');
    expect(active.video[0].maskSettings).toEqual(tl.video[0].maskSettings); expect(active.video[0].smartPicture).toEqual(tl.video[0].smartPicture);
});
