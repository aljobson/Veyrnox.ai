import { colourDefaults } from '../../../../app/veyrnox/_lib/editorColour.mjs';
import { emptyTimeline, type Clip, type Timeline } from '../../src/lib/nativeEditorModel';
import { editorSemanticMaskIdentity } from '../../src/lib/editorSemanticMaskIdentity';

export type MotionAdoptionFixture = {
    readonly id: '24fps' | '60fps';
    readonly timeline: Timeline;
    readonly clip: Clip;
};

function fixture(id: MotionAdoptionFixture['id'], fps: 24 | 60, clipPatch: Partial<Clip>): MotionAdoptionFixture {
    const timeline = emptyTimeline();
    timeline.fps = fps;
    timeline.media = {
        source: { id: 'source', name: `${id} source`, kind: 'video', frames: fps * 60, hasAudio: true, width: 1920, height: 1080 },
        background: { id: 'background', name: `${id} background`, kind: 'image', frames: 1, hasAudio: false, width: 1280, height: 720 },
        mask: { id: 'mask', name: `${id} mask`, kind: 'video', frames: fps * 8, hasAudio: false, width: 512, height: 288 },
    };
    const clip: Clip = {
        id: 'selected', mediaId: 'source', trackId: 'video-0', start: fps * 2, in: fps * 10, len: fps * 4,
        volume: .72, fadeIn: fps / 2, fadeOut: fps / 3, pan: -.2, transition: fps / 4, transitionType: 'wipe-left',
        preservePitch: true, groupId: 'group', fit: 'cover',
        crop: { x: .1, y: .08, width: .78, height: .82 },
        transform: { x: .08, y: -.04, scale: 1.15, rotation: 7, opacity: .86, flipX: true, flipY: false },
        keyframes: [{ frame: 0, x: .08 }, { frame: fps * 2, x: -.12 }],
        parameterKeyframes: [{ frame: 0, brightness: 1.12 }, { frame: fps * 2, brightness: .94 }],
        filter: { brightness: 1.12, contrast: .88, saturate: 1.24, hue: 18, blur: 1.5 },
        colourAdjustment: { ...colourDefaults(), exposure: .35, temperature: -.2, gamma: 1.08 },
        smartPicture: { denoise: .3, keyEnabled: true, keyColor: '#00ff00', keyTolerance: .15, keyFeather: .1,
            despill: .45, light: .2, lightX: .35, lightY: .6, lightRadius: .7 },
        effect: { type: 'chromatic', intensity: .4 }, animation: { in: 'wipe-left', duration: fps },
        background: { type: 'image', color: '#16213e', blur: 12, mediaId: 'background' }, blend: 'screen',
        mask: 'rounded', maskSettings: { x: .5, y: .5, width: .72, height: .64, rotation: 12, feather: .14, inverted: true },
        maskKeyframes: [{ frame: 0, width: .72 }, { frame: fps * 2, width: .58 }],
        eq: { low: 2, mid: -1, high: 3 },
        audioProcessing: { pitch: 2, voice: 'warm', noiseReduction: .4, noiseStart: 10.5, noiseLength: 1.25, gateDb: -42 },
        audioEffects: { width: .35, tremoloRate: 4, tremoloDepth: .2, echoDelay: .18, echoDecay: .45, echoRepeats: 3, echoMix: .22 },
        ...clipPatch,
    };
    clip.semanticMask = { version: 1, mediaId: 'mask', category: 'person', sourceFrame: fps * 10,
        dynamic: { fps, frames: fps * 4, identity: editorSemanticMaskIdentity(clip) } };
    timeline.video = [clip];
    return { id, timeline, clip };
}

export const EDITOR_MOTION_ADOPTION_CORPUS: readonly MotionAdoptionFixture[] = [
    fixture('24fps', 24, { rate: 1.25, reverse: true,
        speedCurve: [{ frame: 0, rate: .75 }, { frame: 48, rate: 1.6 }, { frame: 96, rate: .55 }] }),
    fixture('60fps', 60, { rate: .8, reverse: false,
        speedCurve: [{ frame: 0, rate: 1.4 }, { frame: 90, rate: .6 }, { frame: 180, rate: 1.2 }] }),
] as const;
