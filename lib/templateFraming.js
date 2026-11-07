// Which shape to crop a template's starting photo to. A template that records its own `sourceAspect` keeps it. One that does not, on a
// model that animates a single starting image and has no aspect option of its own, takes the nearest of the three shapes from its
// preview: the model keeps the uploaded image's framing, so a photo of the wrong shape comes out with bars at the sides. Web and mobile
// both read this, so the hint on the template page, the Create card and the app banner all agree.
import { MODELS, templateModelId } from '../app/veyrnox/_lib/tokens.js';
import { nearestShape } from './aspectShapes.mjs';

export { nearestShape };

const animatesOneStartingImage = (model) => !!model && model.media?.image?.required === true && !model.media.image.maxFiles && !model.aspects;

/** The template's own `sourceAspect`, else the preview's nearest shape when its model keeps the starting image's framing, else null. */
export function templateSourceAspect(template, previewAspect = template?.previewAspect) {
    if (!template) return null;
    if (template.sourceAspect) return template.sourceAspect;
    const model = MODELS.find((m) => m.id === templateModelId(template));
    return animatesOneStartingImage(model) ? nearestShape(previewAspect) : null;
}
