import { transitionParams, clipPictureShape, paintLightLeak } from './editorTransitionGeometry.mjs';

const card = (g, W, H, colour, label, v) => {
    g.save();
    g.globalAlpha = v.alpha ?? 1;
    g.filter = v.transitionBlur ? `blur(${(v.transitionBlur * W) / 640}px)` : 'none';
    g.translate(W / 2 + (v.slideX || 0) * W, H / 2 + (v.slideY || 0) * H);
    g.rotate(((v.spin || 0) * Math.PI) / 180);
    g.scale(v.zoom || 1, v.zoom || 1);
    if (v.shape) clipPictureShape(g, -W / 2, -H / 2, W, H, v.shape);
    g.fillStyle = colour; g.fillRect(-W / 2, -H / 2, W, H);
    g.fillStyle = 'rgba(255,255,255,.9)'; g.font = `900 ${Math.round(H * 0.4)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, 0, 0);
    g.restore();
    if (v.leak) paintLightLeak(g, W, H, v.leak);
};

/** Draw one frame of a two-picture transition preview with the compositor's own geometry. False when the id is not handled here. */
export function paintTransitionPreview(g, W, H, id, p) {
    const params = transitionParams(id, p, Math.round(p * 30));
    if (!params) return false;
    g.save();
    g.fillStyle = '#0f172a'; g.fillRect(0, 0, W, H);
    card(g, W, H, '#06b6d4', 'A', params.outgoing);
    card(g, W, H, '#c026d3', 'B', params.incoming);
    g.restore();
    return true;
}
