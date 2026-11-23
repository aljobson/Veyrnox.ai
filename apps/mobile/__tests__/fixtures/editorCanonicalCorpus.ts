import { colourDefaults } from '../../../../app/veyrnox/_lib/editorColour.mjs';
import { emptyTimeline, type Clip, type TextClip, type Timeline } from '../../src/lib/nativeEditorModel';
import type { EditorPreviewCapability } from '../../src/lib/editorPreviewPlan';

export type CanonicalCorpusCase = {
    readonly id: string;
    readonly frame: number;
    readonly timeline: Timeline;
    readonly capabilities: readonly EditorPreviewCapability[];
};

const image = (id: string) => ({ id, kind: 'image', frames: 180, name: id, hasAudio: false, width: 1280, height: 720 });
const visual = (patch: Partial<Clip> = {}): Timeline => {
    const timeline = emptyTimeline();
    timeline.media = { source: image('source') };
    timeline.video = [{ id: 'visual', mediaId: 'source', trackId: 'video-0', start: 0, in: 0, len: 90, volume: 0, transition: 0, ...patch }];
    return timeline;
};
const text = (patch: Partial<TextClip> = {}, fonts?: Timeline['fonts']): Timeline => {
    const timeline = emptyTimeline();
    timeline.text = [{ id: 'text', text: 'One two', trackId: 'text-0', start: 0, len: 90, x: .5, y: .8, size: 8, ...patch }];
    if (fonts) timeline.fonts = fonts;
    return timeline;
};

const colour = colourDefaults();
colour.exposure = .6; colour.temperature = .25; colour.gamma = 1.2;
colour.hsl.red = { hue: 12, saturation: .2, luminance: -.1 };
colour.curves.master = [{ x: 0, y: .05 }, { x: .5, y: .65 }, { x: 1, y: 1 }];

const transition = visual();
transition.media.incoming = image('incoming');
transition.video[0].len = 30;
transition.video.push({ id: 'incoming', mediaId: 'incoming', trackId: 'video-0', start: 30, in: 0, len: 30, volume: 0,
    transition: 10, transitionType: 'wipe-right' });

const imageBackground = visual({ background: { type: 'image', color: '#102030', blur: 0, mediaId: 'background' } });
imageBackground.media.background = image('background');

export const EDITOR_CANONICAL_CORPUS: readonly CanonicalCorpusCase[] = [
    { id: 'blend', frame: 15, timeline: visual({ blend: 'screen' }), capabilities: ['blend'] },
    { id: 'geometric-mask', frame: 15, timeline: visual({ mask: 'rounded', maskSettings: { x: .42, y: .56, width: .7, height: .52,
        rotation: 17, feather: .12, inverted: true } }), capabilities: ['mask'] },
    { id: 'transition', frame: 33, timeline: transition, capabilities: ['transition'] },
    { id: 'reveal', frame: 8, timeline: visual({ animation: { in: 'wipe-left', duration: 30 } }), capabilities: ['animation-reveal'] },
    { id: 'basic-filter', frame: 15, timeline: visual({ filter: { brightness: 1.2, contrast: .85, saturate: 1.3, hue: 24, blur: 2 } }), capabilities: ['basic-filter'] },
    { id: 'smart-picture', frame: 15, timeline: visual({ smartPicture: { denoise: .35, keyEnabled: true, keyColor: '#00ff00', keyTolerance: .18,
        keyFeather: .12, despill: .6, light: .25, lightX: .4, lightY: .6, lightRadius: .7 } }), capabilities: ['smart-picture'] },
    { id: 'advanced-colour', frame: 15, timeline: visual({ colourAdjustment: colour }), capabilities: ['advanced-colour'] },
    { id: 'effect', frame: 15, timeline: visual({ effect: { type: 'chromatic', intensity: .55 } }), capabilities: ['effect'] },
    { id: 'solid-background', frame: 15, timeline: visual({ background: { type: 'solid', color: '#123456', blur: 0, mediaId: '' } }), capabilities: ['clip-background-solid'] },
    { id: 'blur-background', frame: 15, timeline: visual({ background: { type: 'blur', color: '#000000', blur: 18, mediaId: '' } }), capabilities: ['clip-background-blur'] },
    { id: 'image-background', frame: 15, timeline: imageBackground, capabilities: ['clip-background-image'] },
    { id: 'styled-text', frame: 15, timeline: text({ style: { font: 'Georgia', weight: '700', align: 'right', color: '#ffd166', stroke: '#112233',
        strokeWidth: 3, background: '#231942', backgroundOpacity: .7, italic: true, underline: true, letterSpacing: 2, lineHeight: 1.4,
        shadowColor: '#000000', shadowOpacity: .6, shadowBlur: 8, shadowX: 3, shadowY: 4 } }), capabilities: ['text-layer'] },
    { id: 'caption-words', frame: 35, timeline: text({ caption: true, wordsEstimated: false, words: [{ text: 'One', start: 0, len: 30 },
        { text: 'two', start: 30, len: 30 }], wordStyle: { mode: 'karaoke', color: '#ffe66d' } }), capabilities: ['text-layer', 'caption-words'] },
    { id: 'custom-font', frame: 15, timeline: text({ style: { font: 'vx-custom-fixture', weight: 'bold', align: 'center', color: '#ffffff',
        stroke: '#000000', strokeWidth: 0, background: '#000000', backgroundOpacity: 0 } }, [{ family: 'vx-custom-fixture', name: 'Fixture Sans',
        sourceName: 'fixture.ttf', sha256: 'a'.repeat(64), bytes: 1024, format: 'ttf', rights: { credit: 'Fixture', usage: 'Testing', url: 'https://example.test/font' } }]),
        capabilities: ['text-layer', 'custom-font'] },
] as const;
