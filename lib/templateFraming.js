// Which shape to crop a template's starting photo to. A template that records its own `sourceAspect` keeps it. One that does not, on a
// model that animates a single starting image and has no aspect option of its own, takes the nearest of the three shapes from its
// preview: the model keeps the uploaded image's framing, so a photo of the wrong shape comes out with bars at the sides. Web and mobile
// both read this, so the hint on the template page, the Create card and the app banner all agree.
import { MODELS, modelIdForName } from '../app/veyrnox/_lib/tokens.js';

const SHAPES = [['1:1', 1], ['9:16', 9 / 16], ['16:9', 16 / 9]];

function ratioOf(previewAspect) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*[/:]\s*(\d+(?:\.\d+)?)\s*$/.exec(typeof previewAspect === 'string' ? previewAspect : '');
    if (!m) return null;
    const w = Number(m[1]);
    const h = Number(m[2]);
    return w > 0 && h > 0 ? w / h : null;
}

/** The nearest of 1:1, 9:16 and 16:9 to a preview shape written "600 / 1066" or "9:16", or null when it is not readable. */
export function nearestShape(previewAspect) {
    const ratio = ratioOf(previewAspect);
    if (ratio === null) return null;
    let best = null;
    let bestGap = Infinity;
    for (const [shape, value] of SHAPES) {
        const gap = Math.abs(Math.log(ratio / value));
        if (gap < bestGap) {
            best = shape;
            bestGap = gap;
        }
    }
    return best;
}

const animatesOneStartingImage = (model) => !!model && model.media?.image?.required === true && !model.media.image.maxFiles && !model.aspects;

/** The template's own `sourceAspect`, else the preview's nearest shape when its model keeps the starting image's framing, else null. */
export function templateSourceAspect(template, previewAspect = template?.previewAspect) {
    if (!template) return null;
    if (template.sourceAspect) return template.sourceAspect;
    const model = MODELS.find((m) => m.id === modelIdForName(template.model));
    return animatesOneStartingImage(model) ? nearestShape(previewAspect) : null;
}
