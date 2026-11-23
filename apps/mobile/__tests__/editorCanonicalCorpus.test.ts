import { evaluatedMask } from '../../../app/veyrnox/_lib/editorMask.mjs';
import { evaluatedParameters, evaluatedReveal } from '../../../app/veyrnox/_lib/editorAnimation.mjs';
import { captionPresentation } from '../../../app/veyrnox/_lib/editorWords.mjs';
import { sequenceLayers } from '../../../app/veyrnox/_lib/editorSequenceRender.mjs';
import { EDITOR_CANONICAL_CORPUS } from './fixtures/editorCanonicalCorpus';
import { createNativeEditorCompositor } from '../src/lib/editorCompositorNative';
import { CANONICAL_EDITOR_COMPOSITOR_CAPABILITIES, type EditorCompositorFrame } from '../src/lib/editorLocalExport';
import { editorPreviewPlan, type EditorPreviewCapability, type EditorPreviewPlan } from '../src/lib/editorPreviewPlan';

const common: readonly EditorPreviewCapability[] = ['timeline-background', 'image-source', 'graphic-source', 'video-source', 'fit', 'crop', 'transform',
    'visual-layering', 'clip-animation', 'audio-mix'];
const native = () => ({ capabilities: jest.fn(async () => ({ ok: true, platform: 'ios', protocolVersion: 2, features: CANONICAL_EDITOR_COMPOSITOR_CAPABILITIES })), discardFrames: jest.fn(),
    renderFrame: jest.fn(async (_account: string, _project: string, _owner: string, _token: string, _plan: string, _sources: unknown,
        width: number, height: number, index: number, timestampUs: number) => ({ ok: true, version: 1, uri: `file:///cache/corpus-${index}.rgba`, index, timestampUs,
        byteLength: width * height * 4, width, height, stride: width * 4, pixelFormat: 'rgba8', colorSpace: 'srgb' })) });

function visual(plan: EditorPreviewPlan, id = 'visual') { return plan.visuals.find(layer => layer.clip.id === id)!; }
function contractComplete(id: string, plan: EditorPreviewPlan & { fonts?: unknown }) {
    const layer = visual(plan, id === 'transition' ? 'incoming' : 'visual'), item = plan.texts[0];
    if (id === 'blend') return layer?.blend === 'screen';
    if (id === 'geometric-mask') return layer?.mask?.shape === 'rounded' && layer.mask.x === .42 && layer.mask.y === .56
        && layer.mask.width === .7 && layer.mask.height === .52 && layer.mask.rotation === 17 && layer.mask.feather === .12 && layer.mask.inverted === true;
    if (id === 'transition') return layer?.transition?.type === 'wipe-right' && layer.transition.role === 'incoming'
        && layer.transition.duration === 10 && layer.transition.wipe?.direction === 'right' && layer.transition.wipe.progress > 0;
    if (id === 'reveal') return !!layer && layer.reveal.width > 0 && layer.reveal.width < 1;
    if (id === 'basic-filter') return layer?.filter.brightness === 1.2 && layer.filter.contrast === .85 && layer.filter.saturate === 1.3
        && layer.filter.hue === 24 && layer.filter.blur === 2;
    if (id === 'smart-picture') {
        const smart = layer?.clip.smartPicture;
        return smart?.denoise === .35 && smart.keyEnabled === true && smart.keyColor === '#00ff00' && smart.keyTolerance === .18
            && smart.keyFeather === .12 && smart.despill === .6 && smart.light === .25 && smart.lightX === .4 && smart.lightY === .6 && smart.lightRadius === .7;
    }
    if (id === 'advanced-colour') return layer?.colour.exposure === .6 && layer.colour.temperature === .25 && layer.colour.gamma === 1.2
        && layer.colour.hsl.red.hue === 12 && layer.colour.hsl.red.saturation === .2 && layer.colour.hsl.red.luminance === -.1
        && layer.colour.curves.master.length === 3 && layer.colour.curves.master[1].x === .5 && layer.colour.curves.master[1].y === .65;
    if (id === 'effect') return layer?.clip.effect?.type === 'chromatic' && layer.clip.effect.intensity === .55;
    if (id === 'solid-background') return layer?.clip.background?.type === 'solid' && layer.clip.background.color === '#123456';
    if (id === 'blur-background') return layer?.clip.background?.type === 'blur' && layer.clip.background.blur === 18;
    if (id === 'image-background') return layer?.clip.background?.type === 'image' && layer.backgroundMedia?.id === 'background';
    if (id === 'styled-text') {
        const style = item?.item.style;
        return style?.font === 'Georgia' && style.weight === '700' && style.align === 'right' && style.color === '#ffd166'
            && style.stroke === '#112233' && style.strokeWidth === 3 && style.background === '#231942' && style.backgroundOpacity === .7
            && style.italic === true && style.underline === true && style.letterSpacing === 2 && style.lineHeight === 1.4
            && style.shadowColor === '#000000' && style.shadowOpacity === .6 && style.shadowBlur === 8 && style.shadowX === 3 && style.shadowY === 4;
    }
    if (id === 'caption-words') return item?.presentation.text === 'One two'
        && JSON.stringify(item.presentation.ranges) === JSON.stringify([{ from: 0, to: 3 }, { from: 4, to: 7 }]);
    if (id === 'custom-font') return item?.item.style?.font === 'vx-custom-fixture' && item.customFont?.family === 'vx-custom-fixture'
        && item.customFont.sha256 === 'a'.repeat(64) && plan.fonts?.[0]?.family === 'vx-custom-fixture';
    return false;
}

function omitSemantic(id: string, plan: EditorPreviewPlan): EditorPreviewPlan {
    const copy = JSON.parse(JSON.stringify(plan)) as EditorPreviewPlan;
    const layer = visual(copy, id === 'transition' ? 'incoming' : 'visual'), item = copy.texts[0];
    if (id === 'blend') layer.blend = 'source-over';
    else if (id === 'geometric-mask') layer.mask = null;
    else if (id === 'transition') layer.transition = null;
    else if (id === 'reveal') layer.reveal = { x: 0, y: 0, width: 1, height: 1 };
    else if (id === 'basic-filter') layer.filter = { brightness: 1, contrast: 1, saturate: 1, hue: 0, blur: 0 };
    else if (id === 'smart-picture') delete layer.clip.smartPicture;
    else if (id === 'advanced-colour') layer.colour.exposure = 0;
    else if (id === 'effect') delete layer.clip.effect;
    else if (id.endsWith('background')) delete layer.clip.background;
    else if (id === 'styled-text') delete item.item.style;
    else if (id === 'caption-words') item.presentation.ranges = [];
    else if (id === 'custom-font') { item.customFont = null; delete copy.fonts; }
    return copy;
}

test.each(EDITOR_CANONICAL_CORPUS)('$id plan is sourced from web evaluators and detects omitted semantics', fixture => {
    const supported = [...new Set([...common, ...fixture.capabilities])];
    const plan = editorPreviewPlan(fixture.timeline, fixture.frame, supported);
    expect(plan.capabilities.exact).toBe(true);
    expect(contractComplete(fixture.id, plan)).toBe(true);
    expect(contractComplete(fixture.id, omitSemantic(fixture.id, plan))).toBe(false);
    const canonical = sequenceLayers(fixture.timeline, fixture.frame);
    if (plan.visuals.length) {
        const layer = visual(plan, fixture.id === 'transition' ? 'incoming' : 'visual');
        const web = canonical.visuals.find((candidate: { clip: { id: string } }) => candidate.clip.id === layer.clip.id)!;
        expect(layer.reveal).toEqual(evaluatedReveal(web.clip, web.offset));
        expect(layer.filter).toEqual(evaluatedParameters(web.clip, web.offset).filter);
        expect(layer.colour).toEqual(evaluatedParameters(web.clip, web.offset).colour);
        if (layer.mask) expect(layer.mask).toEqual({ ...evaluatedMask(web.clip, web.offset), shape: web.clip.mask });
    }
    if (plan.texts.length) expect(plan.texts[0].presentation).toEqual(captionPresentation(plan.texts[0].item, plan.texts[0].offset));
});

test.each(EDITOR_CANONICAL_CORPUS)('$id canonical JSON reaches the native boundary without semantic loss', async fixture => {
    const supported = [...new Set([...common, ...fixture.capabilities])];
    const plan = editorPreviewPlan(fixture.timeline, fixture.frame, supported), module = native();
    const sources = Object.fromEntries([
        ...Object.keys(fixture.timeline.media).map(id => [id, `file:///documents/${id}.png`] as const),
        ...(fixture.timeline.fonts ?? []).map(font => [font.family, `file:///documents/${font.sha256}.${font.format}`] as const),
    ]);
    const render = createNativeEditorCompositor('account', 'project', sources, module);
    const frame = { plan, index: fixture.frame, timestampUs: fixture.frame * 33_333, width: 640, height: 360 } as EditorCompositorFrame;
    await render(frame, new AbortController().signal);
    const serialized = JSON.parse(module.renderFrame.mock.calls[0][4]) as EditorPreviewPlan;
    expect(contractComplete(fixture.id, serialized)).toBe(true);
});

test.each(EDITOR_CANONICAL_CORPUS)('$id production claim is exact or remains explicitly refused', fixture => {
    const plan = editorPreviewPlan(fixture.timeline, fixture.frame, CANONICAL_EDITOR_COMPOSITOR_CAPABILITIES);
    let missing = false;
    for (const capability of fixture.capabilities) {
        if (!CANONICAL_EDITOR_COMPOSITOR_CAPABILITIES.includes(capability as never)) {
            missing = true;
            expect(plan.capabilities.unsupported).toEqual(expect.arrayContaining([expect.objectContaining({ capability })]));
        }
    }
    if (!missing) { expect(plan.capabilities.exact).toBe(true); expect(contractComplete(fixture.id, plan)).toBe(true); }
});

test('custom-font cannot be advertised before the plan carries validated font metadata', () => {
    const fixture = EDITOR_CANONICAL_CORPUS.find(value => value.id === 'custom-font')!;
    const plan = editorPreviewPlan(fixture.timeline, fixture.frame, [...common, ...fixture.capabilities]) as EditorPreviewPlan & { fonts?: unknown };
    const hasFontPayload = Array.isArray(plan.fonts) && plan.fonts.length > 0;
    if (CANONICAL_EDITOR_COMPOSITOR_CAPABILITIES.includes('custom-font' as never)) expect(hasFontPayload).toBe(true);
    else expect(hasFontPayload).toBe(false);
});
